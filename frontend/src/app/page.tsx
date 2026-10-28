import { redirect } from "next/navigation";

// Default market until geo-detection is added.
export default function Home() {
  redirect("/uk");
}
