/**
 * The host's WhatsApp message for one guest: {name} and {link} are replaced,
 * and the link ends the message when the template leaves it out.
 */
export function invitationMessage(
  template: string,
  name: string,
  link: string,
) {
  const message = template.replaceAll("{name}", name);
  return message.includes("{link}")
    ? message.replaceAll("{link}", link)
    : `${message}\n${link}`;
}

/**
 * Opens WhatsApp on the device with the message written out for an
 * international number (+41791234567). The whatsapp:// scheme is handled by
 * the app itself, so the invitation never travels in a web address's query.
 */
export function whatsappLink(
  phone: string,
  template: string,
  name: string,
  link: string,
) {
  const text = invitationMessage(template, name, link);
  return `whatsapp://send?phone=${phone.slice(1)}&text=${encodeURIComponent(text)}`;
}
