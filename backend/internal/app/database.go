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

// sessionDefaults bound runaway statements, lock queues and abandoned
// transactions on every pooled connection. They limit a statement or an open
// transaction, never an idle session, so the connection that holds the worker
// advisory lock is unaffected. The lock timeout stays above the workers' own
// query deadline so their context, not PostgreSQL, ends a blocked query.
// A connection string may override each value.
var sessionDefaults = map[string]string{
	"statement_timeout":                   "30s",
	"lock_timeout":                        "10s",
	"idle_in_transaction_session_timeout": "60s",
}

func openDatabase(ctx context.Context, databaseURL string) (*sql.DB, error) {
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
	for name, value := range sessionDefaults {
		if _, chosen := config.RuntimeParams[name]; !chosen {
			config.RuntimeParams[name] = value
		}
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
	return db, nil
}
