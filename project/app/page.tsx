import MapDashboard from "./components/MapDashboard";
import LieDetector from "./components/LieDetector";

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-50 p-8 font-sans text-stone-900">
      <div className="max-w-6xl mx-auto space-y-10">
        <section>
          <MapDashboard />
        </section>
        <section>
          <LieDetector />
        </section>
      </div>
    </main>
  );
}
