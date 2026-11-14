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

// databaseConnections bounds the pool. In a load test, 500 phones refetching the
// programme after one change spent nearly all their time waiting for one of 10
// connections; 20 brought the last fresh copy from 260 to 210 ms, well within
// PostgreSQL's default limit of 100 connections.
const databaseConnections = 20

// openDatabase opens a pool of at most connections, or databaseConnections when zero.
func openDatabase(ctx context.Context, databaseURL string, connections int) (*sql.DB, error) {
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
	if connections == 0 {
		connections = databaseConnections
	}
	// Keeping every pooled connection idle avoids reconnecting under bursty
	// traffic: with 2 idle connections a load test opened about 140 new
	// PostgreSQL connections per second.
	db.SetMaxOpenConns(connections)
	db.SetMaxIdleConns(connections)
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
