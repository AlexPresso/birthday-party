import { Invitation } from "@/components/invitation";
import { getBirthdayConfig } from "@/lib/birthday-config";

export default async function InvitationPage() {
  const { age, title, description } = await getBirthdayConfig();
  return <Invitation age={age} title={title} description={description} />;
}
