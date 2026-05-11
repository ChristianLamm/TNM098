import MapDashboard from "./components/MapDashboard";
import LieDetector from "./components/LieDetector";

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-50 p-8 font-sans text-stone-900">
      <div className="max-w-6xl mx-auto space-y-10">
        <header className="text-center space-y-3">
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-cyan-600">
            Kasios Investigation Dashboard
          </h1>
          <p className="text-lg text-stone-600 max-w-2xl mx-auto">
            Visual analytics tool to track bird populations and analyze suspicious audio recordings.
          </p>
        </header>

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
