import { Invitation } from "@/features/guests/invitation";
import { getBirthdayConfig } from "@/features/party/birthday-config";

export default async function InvitationPage() {
  const { age, title, description } = await getBirthdayConfig();
  return <Invitation age={age} title={title} description={description} />;
}
