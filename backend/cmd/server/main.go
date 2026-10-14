package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"birthday-party/backend/internal/app"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	config, err := app.ConfigFromEnv()
	if err != nil {
		return err
	}
	application, err := app.Open(config)
	if err != nil {
		return err
	}
	defer application.Close()
	if command == "invite-admin" {
		flags := flag.NewFlagSet(command, flag.ContinueOnError)
		name := flags.String("name", "", "Name of the host")
		if err := flags.Parse(os.Args[2:]); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		url, err := application.InviteAdmin(ctx, *name)
		if err != nil {
			return err
		}
		fmt.Println(url)
		return nil
	}
	if command != "serve" {
		return errors.New("usage: server serve | server invite-admin --name NAME")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	listener, err := net.Listen("tcp", config.ListenAddr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	defer listener.Close()
	var invitationURL string
	if config.PrintAdminInvitation {
		invitationContext, cancel := context.WithTimeout(ctx, 10*time.Second)
		invitationURL, err = application.StartupAdminInvitation(invitationContext)
		cancel()
		if err != nil {
			return fmt.Errorf("create startup administrator invitation: %w", err)
		}
	}
	server := &http.Server{Addr: config.ListenAddr, Handler: application.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Minute, WriteTimeout: 10 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.Serve(listener) }()
	log.Printf("Birthday API listening on %s", listener.Addr())
	if invitationURL != "" {
		fmt.Printf("Administrator invitation: %s\n", invitationURL)
	}
	select {
	case err := <-serverErrors:
		if err == http.ErrServerClosed {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}
