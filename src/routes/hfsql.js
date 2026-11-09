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

    // Calcular fecha actual y fecha anterior en formato YYYYMMDD
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const pFechaHoy = `${yyyy}${mm}${dd}`;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yy = yesterday.getFullYear();
    const ym = String(yesterday.getMonth() + 1).padStart(2, '0');
    const yd = String(yesterday.getDate()).padStart(2, '0');
    const pFechaAyer = `${yy}${ym}${yd}`;

    logger.info({ pFechaHoy, pFechaAyer }, 'CONSULTANDO CHECKOUTS PARA FECHAS');

    const sql = `SELECT BR.*, R.sLABEL FROM BOOKING_ROOMS BR INNER JOIN ROOMS R ON BR.nID_ROOMS = R.nID_ROOMS WHERE BR.nSTATE = 3 AND BR.dEndDate IN (${pFechaHoy}, ${pFechaAyer})`;
    const result = await hfsql.query(sql);

    // Mapear los resultados al formato requerido
    const checkouts = (result.rows || []).map((row) => {
      // Función auxiliar para obtener valor case-insensitive
      const get = (key) => {
        const lower = key.toLowerCase();
        for (const k of Object.keys(row)) {
          if (k.toLowerCase() === lower) return row[k];
        }
        return null;
      };
      return {
        name: get('sLabel1'),
        state: get('nState'),
        comments: get('sComments'),
        room: get('sLabel'),
        // También incluir todos los campos originales por si se necesitan
        raw: row,
      };
    });

    res.json({
      success: true,
      dates: [pFechaAyer, pFechaHoy],
      count: checkouts.length,
      checkouts,
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

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yy = yesterday.getFullYear();
    const ym = String(yesterday.getMonth() + 1).padStart(2, '0');
    const yd = String(yesterday.getDate()).padStart(2, '0');
    const pFechaAyer = `${yy}${ym}${yd}`;

    const sql = `SELECT BR.*, R.sLABEL FROM BOOKING_ROOMS BR INNER JOIN ROOMS R ON BR.nID_ROOMS = R.nID_ROOMS WHERE BR.nSTATE = 3 AND BR.dEndDate IN (${pFechaHoy}, ${pFechaAyer})`;
    const result = await hfsql.query(sql);

    const checkouts = (result.rows || []).map((row) => {
      const get = (key) => {
        const lower = key.toLowerCase();
        for (const k of Object.keys(row)) {
          if (k.toLowerCase() === lower) return row[k];
        }
        return null;
      };
      return {
        name: get('sLabel1'),
        state: get('nState'),
        comments: get('sComments'),
        room: get('sLabel'),
      };
    });

    res.json({
      success: true,
      dates: [pFechaAyer, pFechaHoy],
      count: checkouts.length,
      checkouts,
    });
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER CHECKOUTS (EXTERNAL)');
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;