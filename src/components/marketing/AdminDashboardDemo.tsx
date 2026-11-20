import { Activity, Building2, ShieldCheck, Users } from "lucide-react";

const CAPABILITIES = [
  { icon: Activity, title: "Adoption and activation", detail: "Aggregate usage signals become available as students use enabled surfaces." },
  { icon: Building2, title: "Building-level readiness", detail: "Compare supported residence halls without presenting individual student activity." },
  { icon: Users, title: "Community operations", detail: "Understand participation across verified campus communities and support workflows." },
  { icon: ShieldCheck, title: "Privacy-conscious reporting", detail: "Operator views are aggregate and scoped to authorized university administrators." },
] as const;

/** A non-data preview of the university dashboard's supported capabilities. */
export function AdminDashboardDemo() {
  return (
    <div className="rounded-editorial border border-stone-200 bg-white p-5 shadow-raised md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-5">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-malachite-800">Operator view</p>
          <h3 className="mt-1 font-serif text-2xl font-semibold text-stone-900">Live signals from your campus</h3>
        </div>
        <span className="rounded-full bg-tint-100 px-3 py-1 text-xs font-extrabold text-stone-600">Populated by real activity</span>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {CAPABILITIES.map(({ icon: Icon, title, detail }) => (
          <div key={title} className="rounded-xl border border-stone-200 bg-tint-50 p-4">
            <Icon className="h-5 w-5 text-malachite-800" aria-hidden="true" />
            <p className="mt-3 text-sm font-extrabold text-stone-900">{title}</p>
            <p className="mt-1 text-xs font-semibold leading-relaxed text-stone-600">{detail}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs font-semibold text-stone-500">No sample counts are shown. A pilot dashboard remains empty until it receives authorized, real campus activity.</p>
    </div>
  );
}
