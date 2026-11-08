import { Router } from 'express';
import config from '../config.js';
import logger from '../utils/logger.js';
import * as hfsql from '../services/HFSQLService.js';

const router = Router();

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

export default router;