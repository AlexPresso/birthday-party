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
