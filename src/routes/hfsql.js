import { Router } from 'express';
import config from '../config.js';
import logger from '../utils/logger.js';
import * as hfsql from '../services/HFSQLService.js';

const router = Router();

// API token auth for external access
function apiAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de API requerido' });
  }
  const token = authHeader.slice(7);
  if (token !== config.messenger.apiToken) {
    return res.status(401).json({ error: 'Token inválido' });
  }
  next();
}

import jwt from 'jsonwebtoken';

function auth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, config.admin.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

router.get('/status', auth, (req, res) => {
  res.json(hfsql.getStatus());
});

router.post('/connect', auth, async (req, res) => {
  try {
    const result = await hfsql.connect();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/disconnect', auth, async (req, res) => {
  try {
    const result = await hfsql.disconnect();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/test', auth, async (req, res) => {
  try {
    const result = await hfsql.testConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/tables', auth, async (req, res) => {
  try {
    const tables = await hfsql.getTables();
    res.json({ tables });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER TABLAS HFSQL');
    res.status(500).json({ error: err.message });
  }
});

router.get('/columns/:table', auth, async (req, res) => {
  try {
    const columns = await hfsql.getColumns(req.params.table);
    res.json({ columns });
  } catch (err) {
    logger.error({ err, table: req.params.table }, 'ERROR AL OBTENER COLUMNAS HFSQL');
    res.status(500).json({ error: err.message });
  }
});

router.post('/query', auth, async (req, res) => {
  try {
    const { sql, params } = req.body;
    if (!sql || typeof sql !== 'string' || !sql.trim()) {
      return res.status(400).json({ error: 'Se requiere una consulta SQL' });
    }
    const result = await hfsql.query(sql, params || []);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'ERROR AL EJECUTAR QUERY HFSQL');
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener checkouts del día
// Ejecuta la consulta SQL y devuelve los datos mapeados al formato requerido
router.get('/checkouts', auth, async (req, res) => {
  try {
    // Asegurar conexión
    const status = hfsql.getStatus();
    if (!status.connected) {
      await hfsql.connect();
    }

    // Calcular fecha actual en formato YYYYMMDD
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const pFechaHoy = `${yyyy}${mm}${dd}`;

    logger.info({ pFechaHoy }, 'CONSULTANDO CHECKOUTS PARA FECHA');

    const sql = `SELECT BR.*, R.sLABEL FROM BOOKING_ROOMS BR INNER JOIN ROOMS R ON BR.nID_ROOMS = R.nID_ROOMS WHERE BR.nSTATE = 3 AND BR.dEndDate = ${pFechaHoy} ORDER BY R.sLABEL ASC`;
    const result = await hfsql.query(sql);

    // Mapear los resultados al formato requerido
    const get = (row, key) => {
      const lower = key.toLowerCase();
      for (const k of Object.keys(row)) {
        if (k.toLowerCase() === lower) return row[k];
      }
      return null;
    };

    // Detectar campo de propiedad
    const propertyField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['sproperty', 'property', 'spropertyname', 'propertyname', 'nid_property', 'nproperty', 'slabelproperty', 'labelproperty'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    // Detectar campo de tipo (privada/dormitorio)
    const typeField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['stype', 'type', 'sroomtype', 'roomtype', 'scategory', 'category', 'bisprivate', 'isprivate', 'nType', 'ntype'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const checkouts = (result.rows || []).map((row) => {
      const propField = propertyField(row);
      const typField = typeField(row);
      return {
        name: get(row, 'sLabel1'),
        state: get(row, 'nState'),
        comments: get(row, 'sComments'),
        room: get(row, 'sLabel'),
        property: propField ? get(row, propField) : null,
        type: typField ? get(row, typField) : null,
        raw: row,
      };
    });

    // Ordenar: propiedad -> numero de habitacion -> tipo (privada/dormitorio)
    checkouts.sort((a, b) => {
      // Propiedad
      const propA = a.property != null ? String(a.property) : '';
      const propB = b.property != null ? String(b.property) : '';
      if (propA !== propB) return propA.localeCompare(propB);
      // Numero de habitacion (extraer numero de sLabel)
      const roomA = String(a.room || '').replace(/[^0-9]/g, '');
      const roomB = String(b.room || '').replace(/[^0-9]/g, '');
      const numA = roomA ? parseInt(roomA, 10) : 0;
      const numB = roomB ? parseInt(roomB, 10) : 0;
      if (numA !== numB) return numA - numB;
      // Tipo (privada antes que dormitorio, o alfabetico)
      const typeA = String(a.type || '').toLowerCase();
      const typeB = String(b.type || '').toLowerCase();
      return typeA.localeCompare(typeB);
    });

    // Agrupar por propiedad
    const grouped = {};
    for (const c of checkouts) {
      const key = c.property != null ? String(c.property) : 'Sin propiedad';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    }

    res.json({
      success: true,
      date: pFechaHoy,
      count: checkouts.length,
      checkouts,
      grouped,
    });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER CHECKOUTS');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para obtener checkouts (accesible con token de API para uso externo)
router.get('/checkouts/external', apiAuth, async (req, res) => {
  try {
    const status = hfsql.getStatus();
    if (!status.connected) {
      await hfsql.connect();
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const pFechaHoy = `${yyyy}${mm}${dd}`;

    const sql = `SELECT BR.*, R.sLABEL FROM BOOKING_ROOMS BR INNER JOIN ROOMS R ON BR.nID_ROOMS = R.nID_ROOMS WHERE BR.nSTATE = 3 AND BR.dEndDate = ${pFechaHoy} ORDER BY R.sLABEL ASC`;
    const result = await hfsql.query(sql);

    const get = (row, key) => {
      const lower = key.toLowerCase();
      for (const k of Object.keys(row)) {
        if (k.toLowerCase() === lower) return row[k];
      }
      return null;
    };

    const propertyField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['sproperty', 'property', 'spropertyname', 'propertyname', 'nid_property', 'nproperty', 'slabelproperty', 'labelproperty'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const typeField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['stype', 'type', 'sroomtype', 'roomtype', 'scategory', 'category', 'bisprivate', 'isprivate', 'ntype'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const checkouts = (result.rows || []).map((row) => {
      const propField = propertyField(row);
      const typField = typeField(row);
      return {
        name: get(row, 'sLabel1'),
        state: get(row, 'nState'),
        comments: get(row, 'sComments'),
        room: get(row, 'sLabel'),
        property: propField ? get(row, propField) : null,
        type: typField ? get(row, typField) : null,
      };
    });

    checkouts.sort((a, b) => {
      const propA = a.property != null ? String(a.property) : '';
      const propB = b.property != null ? String(b.property) : '';
      if (propA !== propB) return propA.localeCompare(propB);
      const roomA = String(a.room || '').replace(/[^0-9]/g, '');
      const roomB = String(b.room || '').replace(/[^0-9]/g, '');
      const numA = roomA ? parseInt(roomA, 10) : 0;
      const numB = roomB ? parseInt(roomB, 10) : 0;
      if (numA !== numB) return numA - numB;
      const typeA = String(a.type || '').toLowerCase();
      const typeB = String(b.type || '').toLowerCase();
      return typeA.localeCompare(typeB);
    });

    const grouped = {};
    for (const c of checkouts) {
      const key = c.property != null ? String(c.property) : 'Sin propiedad';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    }

    res.json({
      success: true,
      date: pFechaHoy,
      count: checkouts.length,
      checkouts,
      grouped,
    });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER CHECKOUTS (EXTERNAL)');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para obtener check-ins del día (nState = 1)
router.get('/checkins', auth, async (req, res) => {
  try {
    const status = hfsql.getStatus();
    if (!status.connected) {
      await hfsql.connect();
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const pFechaHoy = `${yyyy}${mm}${dd}`;

    logger.info({ pFechaHoy }, 'CONSULTANDO CHECKINS PARA FECHA');

    const sql = `SELECT BR.*, R.sLABEL FROM BOOKING_ROOMS BR INNER JOIN ROOMS R ON BR.nID_ROOMS = R.nID_ROOMS WHERE BR.nSTATE = 1 AND BR.dStartDate = ${pFechaHoy}`;
    const result = await hfsql.query(sql);

    const get = (row, key) => {
      const lower = key.toLowerCase();
      for (const k of Object.keys(row)) {
        if (k.toLowerCase() === lower) return row[k];
      }
      return null;
    };

    const propertyField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['sproperty', 'property', 'spropertyname', 'propertyname', 'nid_property', 'nproperty', 'slabelproperty', 'labelproperty'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const typeField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['stype', 'type', 'sroomtype', 'roomtype', 'scategory', 'category', 'bisprivate', 'isprivate', 'ntype'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const checkins = (result.rows || []).map((row) => {
      const propField = propertyField(row);
      const typField = typeField(row);
      return {
        name: get(row, 'sLabel1'),
        state: get(row, 'nState'),
        comments: get(row, 'sComments'),
        room: get(row, 'sLabel'),
        property: propField ? get(row, propField) : null,
        type: typField ? get(row, typField) : null,
        raw: row,
      };
    });

    checkins.sort((a, b) => {
      const propA = a.property != null ? String(a.property) : '';
      const propB = b.property != null ? String(b.property) : '';
      if (propA !== propB) return propA.localeCompare(propB);
      const roomA = String(a.room || '').replace(/[^0-9]/g, '');
      const roomB = String(b.room || '').replace(/[^0-9]/g, '');
      const numA = roomA ? parseInt(roomA, 10) : 0;
      const numB = roomB ? parseInt(roomB, 10) : 0;
      if (numA !== numB) return numA - numB;
      const typeA = String(a.type || '').toLowerCase();
      const typeB = String(b.type || '').toLowerCase();
      return typeA.localeCompare(typeB);
    });

    const grouped = {};
    for (const c of checkins) {
      const key = c.property != null ? String(c.property) : 'Sin propiedad';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    }

    res.json({
      success: true,
      date: pFechaHoy,
      count: checkins.length,
      checkins,
      grouped,
    });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER CHECKINS');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para obtener check-ins (accesible con token de API para uso externo)
router.get('/checkins/external', apiAuth, async (req, res) => {
  try {
    const status = hfsql.getStatus();
    if (!status.connected) {
      await hfsql.connect();
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const pFechaHoy = `${yyyy}${mm}${dd}`;

    const sql = `SELECT BR.*, R.sLABEL FROM BOOKING_ROOMS BR INNER JOIN ROOMS R ON BR.nID_ROOMS = R.nID_ROOMS WHERE BR.nSTATE = 1 AND BR.dStartDate = ${pFechaHoy}`;
    const result = await hfsql.query(sql);

    const get = (row, key) => {
      const lower = key.toLowerCase();
      for (const k of Object.keys(row)) {
        if (k.toLowerCase() === lower) return row[k];
      }
      return null;
    };

    const propertyField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['sproperty', 'property', 'spropertyname', 'propertyname', 'nid_property', 'nproperty', 'slabelproperty', 'labelproperty'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const typeField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['stype', 'type', 'sroomtype', 'roomtype', 'scategory', 'category', 'bisprivate', 'isprivate', 'ntype'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const checkins = (result.rows || []).map((row) => {
      const propField = propertyField(row);
      const typField = typeField(row);
      return {
        name: get(row, 'sLabel1'),
        state: get(row, 'nState'),
        comments: get(row, 'sComments'),
        room: get(row, 'sLabel'),
        property: propField ? get(row, propField) : null,
        type: typField ? get(row, typField) : null,
      };
    });

    checkins.sort((a, b) => {
      const propA = a.property != null ? String(a.property) : '';
      const propB = b.property != null ? String(b.property) : '';
      if (propA !== propB) return propA.localeCompare(propB);
      const roomA = String(a.room || '').replace(/[^0-9]/g, '');
      const roomB = String(b.room || '').replace(/[^0-9]/g, '');
      const numA = roomA ? parseInt(roomA, 10) : 0;
      const numB = roomB ? parseInt(roomB, 10) : 0;
      if (numA !== numB) return numA - numB;
      const typeA = String(a.type || '').toLowerCase();
      const typeB = String(b.type || '').toLowerCase();
      return typeA.localeCompare(typeB);
    });

    const grouped = {};
    for (const c of checkins) {
      const key = c.property != null ? String(c.property) : 'Sin propiedad';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    }

    res.json({
      success: true,
      date: pFechaHoy,
      count: checkins.length,
      checkins,
      grouped,
    });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER CHECKINS (EXTERNAL)');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para ejecutar SQL (UPDATE, DELETE, etc.) - requiere auth de panel
router.post('/execute', auth, async (req, res) => {
  try {
    const { sql, params } = req.body;
    if (!sql || typeof sql !== 'string' || !sql.trim()) {
      return res.status(400).json({ error: 'Se requiere una consulta SQL' });
    }
    const result = await hfsql.execute(sql, params || []);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'ERROR AL EJECUTAR SQL HFSQL');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para aplicar check-in (cambiar nState a 2 = ocupado)
router.post('/apply-checkin', auth, async (req, res) => {
  try {
    const { bookingRoomId, nIdRooms } = req.body;
    if (!bookingRoomId && !nIdRooms) {
      return res.status(400).json({ error: 'Se requiere bookingRoomId o nIdRooms' });
    }
    const status = hfsql.getStatus();
    if (!status.connected) {
      await hfsql.connect();
    }
    // Update nState to 2 (occupied)
    let sql;
    if (bookingRoomId) {
      sql = `UPDATE BOOKING_ROOMS SET nSTATE = 2 WHERE nID_BOOKING_ROOMS = ${bookingRoomId}`;
    } else {
      sql = `UPDATE BOOKING_ROOMS SET nSTATE = 2 WHERE nID_ROOMS = ${nIdRooms} AND nSTATE = 1`;
    }
    const result = await hfsql.execute(sql);
    logger.info({ bookingRoomId, nIdRooms }, 'CHECK-IN APLICADO, HABITACION OCUPADA');
    res.json({ success: true, message: 'Check-in aplicado, habitación ocupada', result });
  } catch (err) {
    logger.error({ err }, 'ERROR AL APLICAR CHECK-IN');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para cancelar check-in del día
router.post('/cancel-checkin', auth, async (req, res) => {
  try {
    const { bookingRoomId, nIdRooms } = req.body;
    if (!bookingRoomId && !nIdRooms) {
      return res.status(400).json({ error: 'Se requiere bookingRoomId o nIdRooms' });
    }
    const status = hfsql.getStatus();
    if (!status.connected) {
      await hfsql.connect();
    }
    // Set nState back to 0 (cancelled/not pending) or delete
    let sql;
    if (bookingRoomId) {
      sql = `UPDATE BOOKING_ROOMS SET nSTATE = 0 WHERE nID_BOOKING_ROOMS = ${bookingRoomId}`;
    } else {
      sql = `UPDATE BOOKING_ROOMS SET nSTATE = 0 WHERE nID_ROOMS = ${nIdRooms} AND nSTATE = 1`;
    }
    const result = await hfsql.execute(sql);
    logger.info({ bookingRoomId, nIdRooms }, 'CHECK-IN CANCELADO');
    res.json({ success: true, message: 'Check-in cancelado', result });
  } catch (err) {
    logger.error({ err }, 'ERROR AL CANCELAR CHECK-IN');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para obtener todas las reservas desde una fecha en adelante
// Acepta query param ?fromDate=YYYYMMDD (default: hoy)
router.get('/bookings', auth, async (req, res) => {
  try {
    const status = hfsql.getStatus();
    if (!status.connected) {
      await hfsql.connect();
    }

    const fromDate = req.query.fromDate || (() => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      return `${yyyy}${mm}${dd}`;
    })();

    const toDate = req.query.toDate || null;
    const stateFilter = req.query.state ? parseInt(req.query.state, 10) : null;

    logger.info({ fromDate, toDate, stateFilter }, 'CONSULTANDO TODAS LAS RESERVAS');

    let sql = `SELECT BR.*, R.sLABEL FROM BOOKING_ROOMS BR INNER JOIN ROOMS R ON BR.nID_ROOMS = R.nID_ROOMS WHERE BR.dEndDate >= ${fromDate}`;
    if (toDate) sql += ` AND BR.dEndDate <= ${toDate}`;
    if (stateFilter !== null && !isNaN(stateFilter)) sql += ` AND BR.nSTATE = ${stateFilter}`;
    sql += ` ORDER BY BR.dEndDate ASC, R.sLABEL ASC`;

    const result = await hfsql.query(sql);

    const get = (row, key) => {
      const lower = key.toLowerCase();
      for (const k of Object.keys(row)) {
        if (k.toLowerCase() === lower) return row[k];
      }
      return null;
    };

    const propertyField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['sproperty', 'property', 'spropertyname', 'propertyname', 'nid_property', 'nproperty', 'slabelproperty', 'labelproperty'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const typeField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['stype', 'type', 'sroomtype', 'roomtype', 'scategory', 'category', 'bisprivate', 'isprivate', 'ntype'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const bookings = (result.rows || []).map((row) => {
      const propField = propertyField(row);
      const typField = typeField(row);
      return {
        name: get(row, 'sLabel1'),
        state: get(row, 'nState'),
        comments: get(row, 'sComments'),
        room: get(row, 'sLabel'),
        property: propField ? get(row, propField) : null,
        type: typField ? get(row, typField) : null,
        startDate: get(row, 'dStartDate'),
        endDate: get(row, 'dEndDate'),
        raw: row,
      };
    });

    // Agrupar por propiedad
    const grouped = {};
    for (const b of bookings) {
      const key = b.property != null ? String(b.property) : 'Sin propiedad';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(b);
    }

    res.json({
      success: true,
      fromDate,
      toDate: toDate || null,
      count: bookings.length,
      bookings,
      grouped,
    });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER RESERVAS');
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para obtener reservas (accesible con token de API para uso externo)
router.get('/bookings/external', apiAuth, async (req, res) => {
  try {
    const status = hfsql.getStatus();
    if (!status.connected) {
      await hfsql.connect();
    }

    const fromDate = req.query.fromDate || (() => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      return `${yyyy}${mm}${dd}`;
    })();

    const toDate = req.query.toDate || null;
    const stateFilter = req.query.state ? parseInt(req.query.state, 10) : null;

    let sql = `SELECT BR.*, R.sLABEL FROM BOOKING_ROOMS BR INNER JOIN ROOMS R ON BR.nID_ROOMS = R.nID_ROOMS WHERE BR.dEndDate >= ${fromDate}`;
    if (toDate) sql += ` AND BR.dEndDate <= ${toDate}`;
    if (stateFilter !== null && !isNaN(stateFilter)) sql += ` AND BR.nSTATE = ${stateFilter}`;
    sql += ` ORDER BY BR.dEndDate ASC, R.sLABEL ASC`;

    const result = await hfsql.query(sql);

    const get = (row, key) => {
      const lower = key.toLowerCase();
      for (const k of Object.keys(row)) {
        if (k.toLowerCase() === lower) return row[k];
      }
      return null;
    };

    const propertyField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['sproperty', 'property', 'spropertyname', 'propertyname', 'nid_property', 'nproperty', 'slabelproperty', 'labelproperty'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const typeField = (row) => {
      const keys = Object.keys(row).map(k => k.toLowerCase());
      const candidates = ['stype', 'type', 'sroomtype', 'roomtype', 'scategory', 'category', 'bisprivate', 'isprivate', 'ntype'];
      for (const c of candidates) {
        if (keys.includes(c)) return c;
      }
      return null;
    };

    const bookings = (result.rows || []).map((row) => {
      const propField = propertyField(row);
      const typField = typeField(row);
      return {
        name: get(row, 'sLabel1'),
        state: get(row, 'nState'),
        comments: get(row, 'sComments'),
        room: get(row, 'sLabel'),
        property: propField ? get(row, propField) : null,
        type: typField ? get(row, typField) : null,
        startDate: get(row, 'dStartDate'),
        endDate: get(row, 'dEndDate'),
      };
    });

    const grouped = {};
    for (const b of bookings) {
      const key = b.property != null ? String(b.property) : 'Sin propiedad';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(b);
    }

    res.json({
      success: true,
      fromDate,
      toDate: toDate || null,
      count: bookings.length,
      bookings,
      grouped,
    });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER RESERVAS (EXTERNAL)');
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;