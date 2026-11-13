// Package webpush adapts notification delivery to encrypted browser push requests.
package webpush

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"birthday-party/backend/internal/adapters/pushtransport"
	"birthday-party/backend/internal/notifications"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type Sender struct {
	Client  webpush.HTTPClient
	Keys    notifications.SigningKeys
	Subject string
}

var _ notifications.Sender = (*Sender)(nil)

func New(keys notifications.SigningKeys, subject string) *Sender {
	return &Sender{Client: pushtransport.NewClient(), Keys: keys, Subject: subject}
}

func GenerateKeys() (notifications.SigningKeys, error) {
	private, public, err := webpush.GenerateVAPIDKeys()
	return notifications.SigningKeys{Public: public, Private: private}, err
}

func Subject(value, publicURL string) (string, error) {
	if value == "" {
		if pushtransport.ValidEndpoint(publicURL) {
			return publicURL, nil
		}
		return "mailto:notifications@example.invalid", nil
	}
	u, err := url.Parse(value)
	if err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.Fragment == "" {
		return value, nil
	}
	if strings.HasPrefix(value, "mailto:") {
		address := strings.TrimPrefix(value, "mailto:")
		parsed, err := mail.ParseAddress(address)
		if err == nil && parsed.Address == address && parsed.Name == "" {
			return value, nil
		}
	}
	return "", errors.New("VAPID_SUBJECT must be an HTTPS URL or a mailto address")
}

func (s *Sender) Send(ctx context.Context, pending notifications.Pending, ttl time.Duration) notifications.Delivery {
	if !pushtransport.ValidEndpoint(pending.Endpoint) {
		return notifications.DiscardDelivery
	}
	payload, err := json.Marshal(struct {
		Type   notifications.Kind `json:"type"`
		Locale string             `json:"locale"`
	}{Type: pending.Kind, Locale: pending.Locale})
	if err != nil {
		return notifications.DiscardDelivery
	}
	response, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: pending.Endpoint, Keys: webpush.Keys{P256dh: pending.Keys.P256dh, Auth: pending.Keys.Auth},
	}, &webpush.Options{
		HTTPClient: s.Client, Subscriber: strings.TrimPrefix(s.Subject, "mailto:"),
		VAPIDPublicKey: s.Keys.Public, VAPIDPrivateKey: s.Keys.Private,
		TTL: int(ttl.Seconds()), Topic: "birthday-welcome", Urgency: webpush.UrgencyNormal,
	})
	if response != nil && response.Body != nil {
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	}
	if err != nil || response == nil {
		return notifications.RetryDelivery
	}
	return deliveryFor(response.StatusCode)
}

// deliveryFor classifies a push service response. Only a 2xx status confirms
// acceptance, and 404 or 410 mean the subscription no longer exists. Redirects
// are never followed, so repeating the request cannot succeed. Every other
// status, including a rejected request, is a failed attempt; the outbox bounds
// how often and how long those are retried before the message is dropped.
func deliveryFor(status int) notifications.Delivery {
	switch {
	case status >= 200 && status < 300:
		return notifications.Delivered
	case status == http.StatusNotFound || status == http.StatusGone:
		return notifications.RemoveSubscription
	case status >= 300 && status < 400:
		return notifications.DiscardDelivery
	default:
		return notifications.RetryDelivery
	}
}
