import Link from "next/link";
import ARScene from "@/components/ARScene";

export const metadata = {
  title: "AR Experience",
};

export default function ARPage() {
  return (
    <main className="ar-page">
      <ARScene />
      <div className="ar-overlay">
        <Link href="/" className="ar-back" aria-label="Back">
          <span aria-hidden="true">←</span>
        </Link>
      </div>
    </main>
  );
}
