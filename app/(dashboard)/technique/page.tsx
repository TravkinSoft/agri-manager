import { redirect } from "next/navigation";

export default function TechniqueLegacyRoute() {
  redirect("/references?domain=machine-yard&tab=park");
}
