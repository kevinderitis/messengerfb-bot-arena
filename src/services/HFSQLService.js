import config from '../config.js';
import logger from '../utils/logger.js';

let odbcModule = null;
let connection = null;
let connected = false;
let lastError = null;

async function loadOdbc() {
  if (odbcModule) return odbcModule;
  try {
    const mod = await import('odbc');
    odbcModule = mod.default || mod;
    return odbcModule;
  } catch (err) {
    logger.error({ err }, 'NO SE PUDO CARGAR EL MODULO ODBC');
    throw err;
  }
}

function buildConnectionString() {
  const c = config.hfsql;
  if (c.mode === 'classic') {
    return `Driver=${c.driver};ANA=${c.wdd};REP=${c.dataDir};`;
  }
  let cs = `Driver=${c.driver};Server Name=${c.server};Server Port=${c.port};`;
  if (c.database) cs += `Database=${c.database};`;
  if (c.user) cs += `UID=${c.user};`;
  if (c.password) cs += `PWD=${c.password};`;
  return cs;
}

export async function connect() {
  if (connected && connection) {
    return { connected: true, message: 'Ya conectado' };
  }
  try {
    const odbc = await loadOdbc();
    const cs = buildConnectionString();
    logger.info({ mode: config.hfsql.mode, server: config.hfsql.server, database: config.hfsql.database }, 'CONECTANDO A HFSQL');
    connection = await odbc.connect(cs);
    connected = true;
    lastError = null;
    logger.info('CONECTADO A HFSQL');
    return { connected: true, message: 'Conectado' };
  } catch (err) {
    connected = false;
    connection = null;
    lastError = err.message;
    logger.error({ err }, 'ERROR AL CONECTAR A HFSQL');
    throw err;
  }
}

export async function disconnect() {
  if (connection) {
    try {
      await connection.close();
    } catch (err) {
      logger.warn({ err }, 'ERROR AL CERRAR CONEXION HFSQL');
    }
  }
  connection = null;
  connected = false;
  logger.info('DESCONECTADO DE HFSQL');
  return { connected: false };
}

export function getStatus() {
  return {
    connected,
    lastError,
    mode: config.hfsql.mode,
    server: config.hfsql.server,
    port: config.hfsql.port,
    database: config.hfsql.database,
  };
}

export async function testConnection() {
  try {
    await connect();
    const result = await connection.query('SELECT 1');
    await disconnect();
    return { success: true, message: 'Conexión exitosa' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

export async function getTables() {
  if (!connected || !connection) {
    throw new Error('No conectado a HFSQL');
  }
  try {
    const result = await connection.tables(null, null, null, null);
    // result is an array of objects with TABLE_NAME, TABLE_TYPE, etc.
    const tables = result.map((row) => {
      const name = row.TABLE_NAME || row.table_name || row.TABLENAME || Object.values(row)[0];
      const type = row.TABLE_TYPE || row.table_type || '';
      return { name, type };
    });
    return tables;
  } catch (err) {
    logger.error({ err }, 'ERROR AL OBTENER TABLAS HFSQL');
    throw err;
  }
}

export async function getColumns(table) {
  if (!connected || !connection) {
    throw new Error('No conectado a HFSQL');
  }
  try {
    const result = await connection.columns(null, null, table, null);
    const columns = result.map((row) => {
      return {
        name: row.COLUMN_NAME || row.column_name || row.COLUMNNAME || Object.values(row)[0],
        type: row.TYPE_NAME || row.type_name || row.DATA_TYPE || '',
        size: row.COLUMN_SIZE || row.column_size || 0,
        nullable: row.IS_NULLABLE || row.is_nullable || '',
      };
    });
    return columns;
  } catch (err) {
    logger.error({ err, table }, 'ERROR AL OBTENER COLUMNAS HFSQL');
    throw err;
  }
}

export async function query(sql, params = []) {
  if (!connected || !connection) {
    throw new Error('No conectado a HFSQL');
  }
  // Only allow SELECT queries for safety
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('SHOW') && !trimmed.startsWith('DESCRIBE') && !trimmed.startsWith('EXPLAIN')) {
    throw new Error('Solo se permiten consultas SELECT, SHOW, DESCRIBE o EXPLAIN');
  }
  try {
    logger.info({ sql: sql.substring(0, 200) }, 'EJECUTANDO QUERY HFSQL');
    const result = await connection.query(sql, params);
    // Convert BigInt values to Number to avoid JSON serialization errors
    if (Array.isArray(result)) {
      for (const row of result) {
        if (row && typeof row === 'object') {
          for (const key of Object.keys(row)) {
            if (typeof row[key] === 'bigint') {
              row[key] = Number(row[key]);
            }
          }
        }
      }
    }
    logger.info({ resultType: typeof result, isArray: Array.isArray(result), keys: result ? Object.keys(result) : null, length: result?.length }, 'RESULTADO RAW HFSQL');
    // result is an array of row objects, with .columns, .count, etc.
    // But the filter might remove all rows if they have a 'statement' property.
    // Also, result might be an object with a different structure for HFSQL.
    let rows = [];
    let columns = [];
    if (Array.isArray(result)) {
      // The array itself has .columns, .count, .statement properties
      columns = result.columns ? result.columns.map((c) => (typeof c === 'string' ? c : c.name)) : [];
      rows = result.filter((r) => r && typeof r === 'object');
      // If rows have a 'statement' property, they might be metadata, not data
      // But typically data rows don't have 'statement', so this should be fine
      // Remove the array-level properties from individual rows
      if (rows.length > 0 && rows[0].statement !== undefined && rows.length === 1) {
        // Might be just metadata, try to get actual data differently
        rows = [];
      }
    } else if (result && typeof result === 'object') {
      // Maybe result is an object with a rows/data property
      if (Array.isArray(result.rows)) rows = result.rows;
      else if (Array.isArray(result.data)) rows = result.data;
      else if (Array.isArray(result.recordset)) rows = result.recordset;
      if (result.columns) columns = result.columns.map((c) => (typeof c === 'string' ? c : c.name));
    }
    if (columns.length === 0 && rows.length > 0) {
      columns = Object.keys(rows[0]);
    }
    logger.info({ rowCount: rows.length, columnCount: columns.length, columns }, 'RESULTADO PROCESADO HFSQL');
    return { rows, columns, count: Array.isArray(result) ? result.count : (result?.count || rows.length), statement: Array.isArray(result) ? result.statement : result?.statement };
  } catch (err) {
    logger.error({ err, sql }, 'ERROR AL EJECUTAR QUERY HFSQL');
    throw err;
  }
}

export default { connect, disconnect, getStatus, testConnection, getTables, getColumns, query };