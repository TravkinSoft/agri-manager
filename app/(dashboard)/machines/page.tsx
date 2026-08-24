import { redirect } from "next/navigation";

export default function MachinesLegacyRoute() {
  redirect("/references?domain=machine-yard&tab=park");
}
