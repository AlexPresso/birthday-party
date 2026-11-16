-- Sending invitations through WhatsApp ----------------------------------------------
--
-- The host may note a guest's number, in international form, to send their
-- invitation through WhatsApp. Only the administrators' guest list shows it.
ALTER TABLE guests
    ADD COLUMN phone TEXT CHECK (phone ~ '^\+[1-9][0-9]{6,14}$');

-- The message the host sends with each link. Null uses the interface's
-- message in the host's language; it is never public.
ALTER TABLE product_configuration
    ADD COLUMN whatsapp_message TEXT CHECK (char_length(whatsapp_message) BETWEEN 1 AND 1000);
