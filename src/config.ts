export const config = {
  port: parseInt(process.env.PORT || "7000", 10),
  tmdbApiKey: process.env.TMDB_API_KEY || "",
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "dmm_flix",
  },
};
