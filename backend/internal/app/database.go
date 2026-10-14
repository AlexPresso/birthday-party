package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func openDatabase(ctx context.Context, databaseURL, dataDir string) (*sql.DB, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		// Parsing errors can include the connection string and its password.
		return nil, errors.New("DATABASE_URL must be a valid PostgreSQL connection string")
	}
	if config.ConnectTimeout == 0 {
		config.ConnectTimeout = 10 * time.Second
	}
	db := stdlib.OpenDB(*config)
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(2)
	db.SetConnMaxIdleTime(5 * time.Minute)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	if err := migrate(ctx, db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate PostgreSQL: %w", err)
	}
	if err := importSQLite(ctx, db, dataDir); err != nil {
		db.Close()
		return nil, fmt.Errorf("import SQLite: %w", err)
	}
	return db, nil
}

func flag(value bool) int {
	if value {
		return 1
	}
	return 0
}
