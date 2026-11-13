package webpush

import (
	"net/http"
	"testing"

	"birthday-party/backend/internal/notifications"
)

func TestOnlyAcceptedPushResponsesCountAsDelivered(t *testing.T) {
	for _, test := range []struct {
		status int
		want   notifications.Delivery
	}{
		{http.StatusOK, notifications.Delivered},
		{http.StatusCreated, notifications.Delivered},
		{http.StatusNoContent, notifications.Delivered},
		{http.StatusNotFound, notifications.RemoveSubscription},
		{http.StatusGone, notifications.RemoveSubscription},
		{http.StatusBadRequest, notifications.RetryDelivery},
		{http.StatusUnauthorized, notifications.RetryDelivery},
		{http.StatusForbidden, notifications.RetryDelivery},
		{http.StatusRequestTimeout, notifications.RetryDelivery},
		{http.StatusRequestEntityTooLarge, notifications.RetryDelivery},
		{http.StatusTooManyRequests, notifications.RetryDelivery},
		{http.StatusInternalServerError, notifications.RetryDelivery},
		{http.StatusServiceUnavailable, notifications.RetryDelivery},
		{http.StatusTemporaryRedirect, notifications.DiscardDelivery},
		{0, notifications.RetryDelivery},
	} {
		if got := deliveryFor(test.status); got != test.want {
			t.Errorf("status %d classified as %v, want %v", test.status, got, test.want)
		}
	}
}
