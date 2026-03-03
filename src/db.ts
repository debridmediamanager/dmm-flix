import mysql from "mysql2/promise";
import { config } from "./config";

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

export interface StreamRow {
  id: number;
  imdb_id: string;
  season: number | null;
  episode: number | null;
  title: string;
  url: string;
  quality: string | null;
  source: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContentRow {
  id: number;
  imdb_id: string | null;
  tmdb_id: number;
  title: string;
  media_type: "movie" | "tv";
  poster: string | null;
  year: string | null;
  source: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function ensureContentTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content (
      id INT AUTO_INCREMENT PRIMARY KEY,
      imdb_id VARCHAR(20) DEFAULT NULL,
      tmdb_id INT NOT NULL,
      title VARCHAR(500) NOT NULL,
      media_type ENUM('movie', 'tv') NOT NULL,
      poster VARCHAR(500) DEFAULT NULL,
      year VARCHAR(10) DEFAULT NULL,
      source VARCHAR(100) DEFAULT 'cineby',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_tmdb (tmdb_id, media_type),
      INDEX idx_imdb (imdb_id)
    )
  `);
}
