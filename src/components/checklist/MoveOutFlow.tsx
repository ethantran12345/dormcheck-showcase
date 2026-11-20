import React, { useRef, useState, Suspense, lazy } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Sparkles,
  Truck,
  User,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EFFORT_LABELS,
  getMoveOutTiers,
  type Effort,
  type MoveOutDetailSlot,
  type MoveOutOption,
  type MoveOutTier,
} from "@/data/moveOut";
import { useUniversity } from "@/contexts/UniversityContext";

// Lazy: the triage pulls the full checklist hook; only load it once opened.
const MoveOutStuffTriage = lazy(() =>
  import("@/components/checklist/MoveOutStuffTriage").then((m) => ({ default: m.MoveOutStuffTriage })),
);

const cardShell =
  "w-full overflow-hidden rounded-xl border border-border bg-card shadow-raised transition-shadow hover:shadow-overlay";
// h-auto/rounded-none/font-normal hold the row shape against Button's base sizing.
// THREE glyph sizes live inside this button (12px effort icon, 14px seasonal-note
// clock, 20px chevron), so one [&_svg]:size-* can't serve them all: the button takes
// size-5 for the chevrons and the two smaller icons carry `!` at their call sites.
// The chevron tint goes in the [&_svg]:text-* group (matching Button's own
// [&_svg]:text-current) rather than as a plain text-* the glyph inherits — the
// inherit route was measured live and did not hold. Colour is uniform here (the
// effort icon and seasonal-note clock were already muted), so only SIZE needs the
// per-icon `!` overrides at their call sites.
const headerBtn =
  "flex h-auto w-full items-start gap-3 rounded-none p-4 sm:p-5 text-left font-normal transition-colors hover:bg-accent [&_svg]:size-5 [&_svg]:text-muted-foreground";

const EFFORT_ICONS: Record<Effort, LucideIcon> = {
  "you-haul": User,
  "they-help": Truck,
  "white-glove": Sparkles,
};

/**
 * One-tap chooser: what the student wants to do, mapped to the tiers that
 * answer it. The selected pill FILTERS the ladder - only its tiers render -
 * so the page shows one decision's options at a time instead of every vendor.
 */
const CHOOSER_GROUPS: { id: string; labelKey: string; tierIds: string[] }[] = [
  { id: "get-rid", labelKey: "checklist:moveOut.chooser.getRidOfIt", tierIds: ["get-it-gone"] },
  { id: "store", labelKey: "checklist:moveOut.chooser.storeIt", tierIds: ["they-help", "white-glove"] },
  { id: "take-home", labelKey: "checklist:moveOut.chooser.takeItHome", tierIds: ["ship-or-store-yourself"] },
];

/** Name of the window event other components fire to focus a tier here. */
export const MOVE_OUT_JUMP_EVENT = "dormcheck:moveout-jump";

function PricePill({ option }: { option: MoveOutOption }) {
  const isFreeOrEarn = option.priceBand === "earn" || option.priceBand === "free";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
        isFreeOrEarn ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground",
      )}
    >
      {option.priceLabel}
    </span>
  );
}

function EffortBadge({ effort }: { effort: Effort }) {
  const Icon = EFFORT_ICONS[effort];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="!h-3 !w-3" aria-hidden />
      {EFFORT_LABELS[effort]}
    </span>
  );
}

function OptionCta({ option }: { option: MoveOutOption }) {
  const navigate = useNavigate();
  if (!option.cta) return null;
  const btnClasses = "mt-4 w-full bg-foreground font-semibold text-background hover:opacity-90 sm:w-auto";
  if (option.cta.internal) {
    return (
      <Button
        type="button"
        className={btnClasses}
        onClick={() => navigate(option.cta!.href, option.cta!.state ? { state: option.cta!.state } : undefined)}
      >
        {option.cta.label}
      </Button>
    );
  }
  return (
    <Button type="button" asChild className={btnClasses}>
      <a href={option.cta.href} target="_blank" rel="noopener noreferrer">
        {option.cta.label}
        <ExternalLink className="ml-2 h-4 w-4 opacity-90" aria-hidden />
      </a>
    </Button>
  );
}

function MoveOutOptionCard({
  option,
  detailSlots,
}: {
  option: MoveOutOption;
  detailSlots?: Partial<Record<MoveOutDetailSlot, React.ReactNode>>;
}) {
  const [open, setOpen] = useState(false);
  const detail = option.detail ? detailSlots?.[option.detail] : null;

  const card = (
    <div className={cardShell}>
      <Button
        type="button"
        variant="ghost"
        className={headerBtn}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PricePill option={option} />
            <EffortBadge effort={option.effort} />
            {option.tag ? (
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                {option.tag}
              </span>
            ) : null}
          </div>
          <h4 className="mt-2 text-lg font-semibold text-foreground">{option.name}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{option.tagline}</p>
          {option.seasonalNote ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="mt-0.5 !h-3.5 !w-3.5 shrink-0" aria-hidden />
              {option.seasonalNote}
            </p>
          ) : null}
        </div>
        {open ? (
          <ChevronUp className="mt-1 h-5 w-5 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="mt-1 h-5 w-5 shrink-0" aria-hidden />
        )}
      </Button>
      {open ? (
        <div className="border-t border-border px-4 pb-4 pt-4 text-sm text-foreground sm:px-5 sm:pb-5">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Best for:</span> {option.bestFor}
          </p>
          {detail ? (
            <div className="mt-4">{detail}</div>
          ) : (
            <>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-foreground">
                {option.steps.map((step) => (
                  <li key={step} className="leading-relaxed">
                    {step}
                  </li>
                ))}
              </ol>
              {option.priceNote ? (
                <p className="mt-3 text-xs text-muted-foreground">{option.priceNote}</p>
              ) : null}
              <OptionCta option={option} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );

  if (option.featured) {
    return <div className="overflow-hidden rounded-xl shadow-raised ring-1 ring-border">{card}</div>;
  }
  return card;
}

/** The move-out ladder: tiers of options sorted cheapest to priciest, each
 *  card showing price and effort at a glance with expandable directions. */
export function MoveOutFlow({
  detailSlots,
}: {
  detailSlots?: Partial<Record<MoveOutDetailSlot, React.ReactNode>>;
}) {
  const { t } = useTranslation();
  const tierRefs = useRef<Record<string, HTMLElement | null>>({});
  const { university } = useUniversity();
  const moveOutTiers = getMoveOutTiers(university.slug);
  const [triageOpen, setTriageOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string>(CHOOSER_GROUPS[0].id);

  const jumpToTier = (tierId: string) => {
    // Switch to the chooser group that owns the tier, then scroll once the
    // newly-filtered tier sections have rendered.
    const group = CHOOSER_GROUPS.find((g) => g.tierIds.includes(tierId));
    if (group) setActiveGroup(group.id);
    requestAnimationFrame(() => {
      const node = tierRefs.current[tierId];
      if (!node) return;
      const reduceMotion =
        typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  };

  // Other surfaces (the move-out checklist's inline actions) focus a tier by
  // firing this window event, since the tier may be filtered out of the DOM.
  React.useEffect(() => {
    const onJump = (e: Event) => {
      const tierId = (e as CustomEvent<string>).detail;
      if (typeof tierId === "string") jumpToTier(tierId);
    };
    window.addEventListener(MOVE_OUT_JUMP_EVENT, onJump);
    return () => window.removeEventListener(MOVE_OUT_JUMP_EVENT, onJump);
  }, []);

  const visibleTierIds = CHOOSER_GROUPS.find((g) => g.id === activeGroup)?.tierIds ?? [];
  const visibleTiers = moveOutTiers.filter((tier) => visibleTierIds.includes(tier.id));

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="rounded-xl bg-muted px-4 py-4">
        <h2 className="text-base font-semibold text-foreground">{t("checklist:moveOut.whatToDo.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("checklist:moveOut.whatToDo.subtitle")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("checklist:moveOut.whatToDo.title")}>
          {CHOOSER_GROUPS.map((group) => {
            const active = group.id === activeGroup;
            return (
              <Button
                key={group.id}
                type="button"
                variant="ghost"
                aria-pressed={active}
                className={cn(
                  "h-auto rounded-full border px-3.5 py-1.5 text-sm font-medium shadow-raised transition-colors",
                  active
                    ? "border-malachite-800 bg-malachite-800 text-white hover:bg-malachite-800 hover:text-white"
                    : "border-border bg-card text-foreground hover:bg-accent",
                )}
                onClick={() => setActiveGroup(group.id)}
              >
                {t(group.labelKey)}
              </Button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-expanded={triageOpen}
          className="mt-3 h-auto rounded-none p-0 text-sm font-medium text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:bg-transparent hover:text-foreground hover:decoration-foreground"
          onClick={() => setTriageOpen((v) => !v)}
        >
          {triageOpen ? t("checklist:moveOut.triage.hide") : t("checklist:moveOut.triage.show")}
        </Button>
        {triageOpen ? (
          <Suspense fallback={<p className="mt-3 text-sm text-muted-foreground">{t("checklist:moveOut.triage.loading")}</p>}>
            <MoveOutStuffTriage onJumpToTier={jumpToTier} />
          </Suspense>
        ) : null}
      </section>

      {/* Only the selected chooser group's tiers render - the pills above are
          the navigation, so the page never stacks every vendor at once. */}
      <div className="min-w-0 space-y-6 sm:space-y-8">
        {visibleTiers.map((tier: MoveOutTier) => (
          <section
            key={tier.id}
            id={`moveout-tier-${tier.id}`}
            ref={(node) => {
              tierRefs.current[tier.id] = node;
            }}
            className="scroll-mt-24 space-y-3"
          >
            <div>
              <h2 className="text-base font-semibold text-foreground">{tier.heading}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{tier.subheading}</p>
            </div>
            <div className="space-y-3">
              {tier.options.map((option) => (
                <MoveOutOptionCard key={option.id} option={option} detailSlots={detailSlots} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
