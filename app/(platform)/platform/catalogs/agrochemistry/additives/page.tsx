import { redirect } from "next/navigation";

export default function GlobalAdditivesPage() {
  redirect("/platform/catalogs/agrochemistry/pesticides?product_type=additive");
}

