import React, { useState } from "react";
import { useNavigate } from "react-router";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import {
  Box,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  HelpCircle,
  Link2,
  Package,
  Printer,
  QrCode,
  Rows2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { directionsUrl } from "@/lib/maps";
import { MoveInJourney } from "@/components/checklist/MoveInJourney";
import { MoveOutFlow, MOVE_OUT_JUMP_EVENT } from "@/components/checklist/MoveOutFlow";
import { useLogisticsProgress } from "@/hooks/useLogisticsProgress";
import { useMoveOutDate } from "@/hooks/useMoveOutDate";
import { RoomPhotoCapture } from "@/components/checklist/RoomPhotoCapture";
import { useUniversity } from "@/contexts/UniversityContext";
import { hasMoveInContent } from "@/data/moveInSteps";
import { hasMoveOutContent } from "@/data/moveOut";
import { UniversityContentComingSoon } from "@/components/checklist/UniversityContentComingSoon";

const SHIP2PITT_WIZARD_NEED_ITEMS = [
  "Your residence hall, room number, and bed space (e.g. Tower B, 1104-2)",
  "Your PeopleSoft Number",
  "Approximate weight of each box",
  "Declared value (up to $1,000/box, defaults to $100 if left blank)",
  "Your home address and phone number",
] as const;

const SHIP2PITT_BOX_LABEL_PILLS = [
  "checklist:logistics.ship2pitt.boxLabel.yourName",
  "checklist:logistics.ship2pitt.boxLabel.buildingName",
  "checklist:logistics.ship2pitt.boxLabel.floorRoomNumber",
  "checklist:logistics.ship2pitt.boxLabel.box1of4",
  "checklist:logistics.ship2pitt.boxLabel.box2of4",
  "checklist:logistics.ship2pitt.boxLabel.box3of4",
  "checklist:logistics.ship2pitt.boxLabel.box4of4",
] as const;

const SHIP2PITT_DO_NOT_SHIP_PILLS = [
  "checklist:logistics.ship2pitt.doNotShip.medication",
  "checklist:logistics.ship2pitt.doNotShip.idCard",
  "checklist:logistics.ship2pitt.doNotShip.computers",
  "checklist:logistics.ship2pitt.doNotShip.instruments",
  "checklist:logistics.ship2pitt.doNotShip.noReceipt",
  "checklist:logistics.ship2pitt.doNotShip.caniedFood",
  "checklist:logistics.ship2pitt.doNotShip.refrigerators",
  "checklist:logistics.ship2pitt.doNotShip.flammables",
  "checklist:logistics.ship2pitt.doNotShip.liquids",
  "checklist:logistics.ship2pitt.doNotShip.glass",
  "checklist:logistics.ship2pitt.doNotShip.upsRestricted",
] as const;

const SHIP2PITT_UPS_PORTAL_URL =
  "https://row.ups.com/Entry/GuestAccess/8557e1a8-9945-4696-93eb-ad5320353089";

const SHIP2PITT_LOGISTICS_URL = "https://www.logistics.pitt.edu/ship2pitt/";

const SHIP2PITT_KEY_DATES = [
  { date: "Jul 7", labelKey: "checklist:logistics.ship2pitt.keyDates.portalOpens" },
  { date: "Jul 14", labelKey: "checklist:logistics.ship2pitt.keyDates.printLabels" },
  { date: "Jul 22", labelKey: "checklist:logistics.ship2pitt.keyDates.shipBy" },
  { date: "Jul 29 to Aug 6", labelKey: "checklist:logistics.ship2pitt.keyDates.delivered" },
] as const;

const SHIP2PITT_BOX_SPEC_CHIPS = [
  "checklist:logistics.ship2pitt.specs.fourBoxesFree",
  "checklist:logistics.ship2pitt.specs.maxDimensions",
  "checklist:logistics.ship2pitt.specs.maxWeight",
  "checklist:logistics.ship2pitt.specs.retailOnly",
] as const;

const SHIP2PITT_PACKING_TIPS = [
  "checklist:logistics.ship2pitt.packingTips.newBox",
  "checklist:logistics.ship2pitt.packingTips.fillSpaces",
  "checklist:logistics.ship2pitt.packingTips.sealTape",
] as const;

const SHIP2PITT_FAQ_CARDS = [
  {
    qKey: "checklist:logistics.ship2pitt.faq.boxNotInRoom.q",
    aKey: "checklist:logistics.ship2pitt.faq.boxNotInRoom.a",
  },
  {
    qKey: "checklist:logistics.ship2pitt.faq.itemsDamaged.q",
    aKey: "checklist:logistics.ship2pitt.faq.itemsDamaged.a",
  },
  {
    qKey: "checklist:logistics.ship2pitt.faq.foundBoxes.q",
    aKey: "checklist:logistics.ship2pitt.faq.foundBoxes.a",
  },
  {
    qKey: "checklist:logistics.ship2pitt.faq.whenArrive.q",
    aKey: "checklist:logistics.ship2pitt.faq.whenArrive.a",
  },
] as const;

const SHIP2HOME_LOGISTICS_URL = "https://www.logistics.pitt.edu/ship2home/";

const SHIP2HOME_TOWER_B_LOCATION_URL = directionsUrl({
  query: "Litchfield Tower B Mailroom, University of Pittsburgh",
});

const SHIP2HOME_UPS_PACKING_URL = "https://www.ups.com/us/en/support/shipping-support";

const SHIP2HOME_UPS_CLAIM_URL = "https://www.ups.com/us/en/support/file-a-claim";


const SHIP2HOME_DO_NOT_SHIP_PILLS = [
  "Electronics",
  "Liquids",
  "Flammables",
  "Fragile items",
  "Glass",
] as const;

const STORE_PITT_DON_FARR_URL = "https://donfarrmoving.com/contact-us/";

const STORE_PITT_LOGISTICS_URL = "https://www.logistics.pitt.edu/storepitt/";

const STORE_PITT_PLANS = [
  {
    name: "Dorm Room Special",
    price: "$1,500",
    summary: "Don Farr packs and delivers (full service)",
    featured: true,
  },
  {
    name: "Dock Dash",
    price: "$500",
    summary: "You pack, drop at the dock",
    featured: true,
  },
  {
    name: "On-Campus Drop-Off",
    price: "$500",
    summary: "On-campus drop, no car needed",
    featured: true,
  },
  {
    name: "Box Deal",
    price: "$50",
    summary: "10 boxes + tape, no storage",
    featured: false,
  },
] as const;


const STORE_PITT_STEP2_HAVE_READY = [
  "Your chosen plan (Dorm Room Special, Dock Dash, or On-Campus Drop-Off)",
  "Your current residence hall and room number",
  "Your new fall residence address (if known)",
  "Payment method",
] as const;

function StorePittWizard() {
  const { t } = useTranslation();
  const keyDates = [
    { date: "Spring", labelKey: "checklist:logistics.storepitt.keyDates.dropOff" },
    { date: "August", labelKey: "checklist:logistics.storepitt.keyDates.getBack" },
  ] as const;

  const faqCards = [
    {
      qKey: "checklist:logistics.storepitt.faq.pickupInstead.q",
      aKey: "checklist:logistics.storepitt.faq.pickupInstead.a",
    },
  ] as const;

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Calendar} labelKey="checklist:logistics.storepitt.keyDates.label" />
        <div className="scrollbar-hide -mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1">
          {keyDates.map((step, i) => (
            <React.Fragment key={step.date}>
              <div className="shrink-0 rounded-lg bg-card px-3 py-2 text-center shadow-raised">
                <p className="text-xs font-bold tabular-nums text-foreground">{step.date}</p>
                <p className="mt-0.5 whitespace-nowrap text-[11px] leading-tight text-muted-foreground">{t(step.labelKey)}</p>
              </div>
              {i < keyDates.length - 1 ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />
              ) : null}
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Rows2} labelKey="checklist:logistics.storepitt.choosePlan" />
        <div className="divide-y divide-border">
          {STORE_PITT_PLANS.map((plan) => (
            <div key={plan.name} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <div
                className={cn(
                  "min-w-[56px] shrink-0 rounded-lg px-2 py-1.5 text-center text-sm font-bold",
                  plan.featured ? "bg-muted text-foreground" : "bg-muted text-foreground",
                )}
              >
                {plan.price}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                <p className="text-sm text-muted-foreground">{plan.summary}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          All plans cover boxed belongings and furniture; you pay Don Farr directly.
        </p>
      </section>

      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={CheckSquare} labelKey="checklist:logistics.storepitt.haveReady" />
        <ul className="space-y-1.5">
          {STORE_PITT_STEP2_HAVE_READY.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
        <p className="font-semibold">⚠️ {t("checklist:logistics.storepitt.augustDelivery.title")}</p>
        <p className="mt-1">
          {t("checklist:logistics.storepitt.augustDelivery.note")}
        </p>
      </div>

      <section>
        <Ship2PittSectionHeader icon={HelpCircle} labelKey="checklist:logistics.common.faq" />
        <div className="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
          {faqCards.map((card) => (
            <div key={card.qKey}>
              <p className="text-sm font-semibold text-foreground">{t(card.qKey)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t(card.aKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Link2} labelKey="checklist:logistics.common.resources" />
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <a
            href={STORE_PITT_LOGISTICS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            Pitt Logistics Store@Pitt →
          </a>
        </div>
        <Button
          asChild
          className="mt-4 h-auto w-full bg-malachite-800 py-3 text-base font-semibold text-white hover:bg-malachite-900" // KEEP: primary CTA for Store@Pitt flow
        >
          <a href={STORE_PITT_DON_FARR_URL} target="_blank" rel="noopener noreferrer">
            Contact Don Farr Moving →
          </a>
        </Button>
      </section>
    </div>
  );
}

function Ship2HomeWizard() {
  const { t } = useTranslation();
  const keyDates = [
    { date: "Apr 13 to 24", labelKey: "checklist:logistics.ship2home.keyDates.pickUpSupplies" },
    { date: "At home", labelKey: "checklist:logistics.ship2home.keyDates.packBoxes" },
    { date: "May 1", labelKey: "checklist:logistics.ship2home.keyDates.dropOff" },
  ] as const;

  const specChips = [
    "checklist:logistics.ship2home.specs.price",
    "checklist:logistics.ship2home.specs.boxCount",
    "checklist:logistics.ship2home.specs.maxWeight",
    "checklist:logistics.ship2home.specs.unsealed",
  ] as const;

  const packingTips = ["checklist:logistics.ship2home.packingTips.declaredValue"] as const;

  const faqCards = [
    {
      qKey: "checklist:logistics.ship2home.faq.itemsDamaged.q",
      aKey: "checklist:logistics.ship2home.faq.itemsDamaged.a",
    },
    {
      qKey: "checklist:logistics.ship2home.faq.upsPickup.q",
      aKey: "checklist:logistics.ship2home.faq.upsPickup.a",
    },
    {
      qKey: "checklist:logistics.ship2home.faq.shipWhere.q",
      aKey: "checklist:logistics.ship2home.faq.shipWhere.a",
    },
  ] as const;

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Calendar} labelKey="checklist:logistics.common.keyDates" />
        <div className="scrollbar-hide -mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1">
          {keyDates.map((step, i) => (
            <React.Fragment key={step.date}>
              <div className="shrink-0 rounded-lg bg-card px-3 py-2 text-center shadow-raised">
                <p className="text-xs font-bold tabular-nums text-foreground">{step.date}</p>
                <p className="mt-0.5 whitespace-nowrap text-[11px] leading-tight text-muted-foreground">{t(step.labelKey)}</p>
              </div>
              {i < keyDates.length - 1 ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />
              ) : null}
            </React.Fragment>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("checklist:logistics.ship2home.noReservationNeeded")}</p>
      </section>

      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Box} labelKey="checklist:logistics.common.whatYouNeed" />
        <div className="flex flex-wrap gap-2">
          {specChips.map((chipKey) => (
            <span
              key={chipKey}
              className="rounded-lg bg-card px-3 py-2 text-xs font-medium text-foreground shadow-raised"
            >
              {t(chipKey)}
            </span>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("checklist:logistics.ship2home.paidByCard")}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("checklist:logistics.ship2home.pickUpAt")}
          <a
            href={SHIP2HOME_TOWER_B_LOCATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            Tower B
          </a>
          .
        </p>
      </section>

      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Package} labelKey="checklist:logistics.common.packItRight" />
        <ul className="space-y-1">
          {packingTips.map((tipKey) => (
            <li key={tipKey} className="flex items-start gap-2 text-sm text-foreground">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
              <span>{t(tipKey)}</span>
            </li>
          ))}
        </ul>
        <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-red-700">{t("checklist:logistics.common.doNotShip")}</p>
        <div className="flex flex-wrap gap-1.5">
          {SHIP2HOME_DO_NOT_SHIP_PILLS.map((pill) => (
            <span
              key={pill}
              className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
            >
              {pill}
            </span>
          ))}
        </div>
      </section>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
        <p className="font-semibold">⚠️ {t("checklist:logistics.ship2home.dropOffAtTowerB.title")}</p>
        <p className="mt-1">
          {t("checklist:logistics.ship2home.dropOffAtTowerB.note")}
        </p>
      </div>

      <section>
        <Ship2PittSectionHeader icon={HelpCircle} labelKey="checklist:logistics.common.faq" />
        <div className="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
          {faqCards.map((card) => (
            <div key={card.qKey}>
              <p className="text-sm font-semibold text-foreground">{t(card.qKey)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t(card.aKey)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Link2} labelKey="checklist:logistics.common.resources" />
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <a
            href={SHIP2HOME_LOGISTICS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            Pitt Logistics Ship2Home →
          </a>
          <a
            href={SHIP2HOME_UPS_PACKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            UPS packing guidelines →
          </a>
          <a
            href={SHIP2HOME_UPS_CLAIM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            File a UPS claim →
          </a>
        </div>
        <Button
          asChild
          className="mt-4 h-auto w-full bg-malachite-800 py-3 text-base font-semibold text-white hover:bg-malachite-900" // KEEP: primary CTA for Ship2Home flow
        >
          <a href={SHIP2HOME_TOWER_B_LOCATION_URL} target="_blank" rel="noopener noreferrer">
            Tower B mailroom →
          </a>
        </Button>
      </section>
    </div>
  );
}

function Ship2PittSectionHeader({ icon: Icon, labelKey }: { icon: LucideIcon; labelKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
      <h4 className="text-sm font-semibold text-foreground">{t(labelKey)}</h4>
    </div>
  );
}

function Ship2PittWizard() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      {/* 1. Key dates */}
      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Calendar} labelKey="checklist:logistics.common.keyDates" />
        <div className="scrollbar-hide -mx-1 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-1">
          {SHIP2PITT_KEY_DATES.map((step, i) => (
            <React.Fragment key={step.date}>
              <div className="shrink-0 rounded-lg bg-card px-3 py-2 text-center shadow-raised">
                <p className="text-xs font-bold tabular-nums text-foreground">{step.date}</p>
                <p className="mt-0.5 whitespace-nowrap text-[11px] leading-tight text-muted-foreground">{t(step.labelKey)}</p>
              </div>
              {i < SHIP2PITT_KEY_DATES.length - 1 ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />
              ) : null}
            </React.Fragment>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("checklist:logistics.ship2pitt.onCampusOnly")}</p>
      </section>

      {/* 2. What you'll need (buy boxes) */}
      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Box} labelKey="checklist:logistics.common.whatYouNeed" />
        <div className="flex flex-wrap gap-2">
          {SHIP2PITT_BOX_SPEC_CHIPS.map((chipKey) => (
            <span
              key={chipKey}
              className="rounded-lg bg-card px-3 py-2 text-xs font-medium text-foreground shadow-raised"
            >
              {t(chipKey)}
            </span>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
          <a
            href="https://www.homedepot.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            Home Depot
          </a>
          <a
            href="https://www.lowes.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            Lowe&apos;s
          </a>
          <span className="text-xs text-muted-foreground">{t("checklist:logistics.ship2pitt.affiliate")}</span>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("checklist:logistics.ship2pitt.extrasCost")}
        </p>
      </section>

      {/* 3. Print your labels */}
      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Printer} labelKey="checklist:logistics.ship2pitt.printLabels.label" />
        <p className="mb-3 text-sm text-muted-foreground">
          {t("checklist:logistics.ship2pitt.printLabels.note")}
        </p>
        <ul className="space-y-1.5">
          {SHIP2PITT_WIZARD_NEED_ITEMS.map((line) => (
            <li key={line} className="flex items-start gap-2 text-sm text-foreground">
              <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("checklist:logistics.ship2pitt.twoWaysToGetLabels")}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex gap-3">
            <Printer className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{t("checklist:logistics.ship2pitt.printAtHome.title")}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("checklist:logistics.ship2pitt.printAtHome.desc")}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{t("checklist:logistics.ship2pitt.qrCode.title")}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("checklist:logistics.ship2pitt.qrCode.desc")}
              </p>
            </div>
          </div>
        </div>

        <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("checklist:logistics.ship2pitt.writeOnEveryBox")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SHIP2PITT_BOX_LABEL_PILLS.map((pillKey) => (
            <span
              key={pillKey}
              className="rounded-full bg-card px-2.5 py-0.5 text-xs font-medium text-foreground shadow-raised"
            >
              {t(pillKey)}
            </span>
          ))}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          {t("checklist:logistics.ship2pitt.trackingInfo")}
        </p>
      </section>

      {/* 4. Pack it right */}
      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Package} labelKey="checklist:logistics.common.packItRight" />
        <ul className="space-y-1">
          {SHIP2PITT_PACKING_TIPS.map((tipKey) => (
            <li key={tipKey} className="flex items-start gap-2 text-sm text-foreground">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" aria-hidden />
              <span>{t(tipKey)}</span>
            </li>
          ))}
        </ul>
        <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-red-700">{t("checklist:logistics.common.doNotShip")}</p>
        <div className="flex flex-wrap gap-1.5">
          {SHIP2PITT_DO_NOT_SHIP_PILLS.map((pillKey) => (
            <span
              key={pillKey}
              className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800"
            >
              {t(pillKey)}
            </span>
          ))}
        </div>
      </section>

      {/* 5. Early-arrival warning */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
        <p className="font-semibold">⚠️ {t("checklist:logistics.ship2pitt.earlyArrival.title")}</p>
        <p className="mt-1">
          {t("checklist:logistics.ship2pitt.earlyArrival.note")}
        </p>
      </div>

      {/* 6. FAQ */}
      <section>
        <Ship2PittSectionHeader icon={HelpCircle} labelKey="checklist:logistics.common.faq" />
        <div className="space-y-4 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
          {SHIP2PITT_FAQ_CARDS.map((card) => (
            <div key={card.qKey}>
              <p className="text-sm font-semibold text-foreground">{t(card.qKey)}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t(card.aKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 7. Resources + CTA */}
      <section className="rounded-xl bg-muted px-4 py-4">
        <Ship2PittSectionHeader icon={Link2} labelKey="checklist:logistics.common.resources" />
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <a
            href={SHIP2PITT_LOGISTICS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            Pitt Logistics Ship2Pitt →
          </a>
          <a
            href="mailto:Ship2Pitt@pitt.edu"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            Ship2Pitt@pitt.edu
          </a>
          <a
            href="tel:+14126481100"
            className="font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground"
          >
            Panther Central 412-648-1100
          </a>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("checklist:logistics.ship2pitt.amazonNote")}
        </p>
        <Button
          asChild
          className="mt-4 h-auto w-full bg-malachite-800 py-3 text-base font-semibold text-white hover:bg-malachite-900" // KEEP: primary CTA for Ship2Pitt flow
        >
          <a href={SHIP2PITT_UPS_PORTAL_URL} target="_blank" rel="noopener noreferrer">
            Create labels on UPS →
          </a>
        </Button>
      </section>
    </div>
  );
}

/** Move-out tasks, grouped by timing. Discrete so each is checkable. */
const MOVE_OUT_TASKS: { id: string; group: string; title: string }[] = [
  { id: "mo-storage", group: "2 weeks before", title: "Book storage or shipping if you need it" },
  { id: "mo-mail", group: "2 weeks before", title: "Forward your mail or update your address" },
  { id: "mo-pack", group: "1 week before", title: "Pack the things you're not using" },
  { id: "mo-sell", group: "1 week before", title: "Donate or sell what you're not taking home" },
  { id: "mo-contract", group: "1 week before", title: "Check your housing contract for checkout rules" },
  { id: "mo-splits", group: "1 week before", title: "Settle up any shared costs with roommates" },
  { id: "mo-fridge", group: "Move-out day", title: "Empty and wipe down your fridge & microwave" },
  { id: "mo-sweep", group: "Move-out day", title: "Sweep drawers, closet, and outlets for chargers" },
  { id: "mo-key", group: "Move-out day", title: "Return your room key to the front desk" },
  { id: "mo-walkthrough", group: "Move-out day", title: "Do a final walkthrough with your RA" },
  { id: "mo-photos", group: "Move-out day", title: "Take photos of the room condition" },
];

/** Days before move-out each timing group lands on (for real dates). */
const MOVE_OUT_GROUP_OFFSETS: Record<string, number> = {
  "2 weeks before": -14,
  "1 week before": -7,
  "Move-out day": 0,
};

function moveOutGroupLabel(group: string, moveOutDate: Date | null): string {
  if (!moveOutDate) return group;
  const offset = MOVE_OUT_GROUP_OFFSETS[group];
  if (offset === undefined) return group;
  const date = new Date(moveOutDate.getTime() + offset * 24 * 60 * 60 * 1000);
  return `${offset === 0 ? "" : "By "}${format(date, "EEE, MMM d")} · ${group}`;
}

/** Focus a move-out ladder tier in MoveOutFlow lower on the page. Fired as an
 *  event (not a direct scroll) because the flow filters tiers by chooser group,
 *  so the target may not be in the DOM until the flow switches groups. */
function scrollToMoveOutTier(tierId: string) {
  window.dispatchEvent(new CustomEvent(MOVE_OUT_JUMP_EVENT, { detail: tierId }));
}

/** Interactive move-out checklist - tick tasks off (persisted per user in
 *  localStorage, no backend) with a live progress bar. Replaces the old static
 *  read-only timeline so the page actually does something for the student. */
function MoveOutChecklist({ moveOutDate }: { moveOutDate: Date | null }) {
  const { t } = useTranslation();
  const { doneIds: done, toggle } = useLogisticsProgress("moveout");
  const navigate = useNavigate();

  // Tasks the product can actually do something about get an inline action
  // instead of leaving the student to go find the flow themselves.
  const taskActions: Record<string, React.ReactNode> = {
    "mo-splits": (
      <Button type="button" variant="link" className={taskActionBtn} onClick={() => navigate("/checklist")}>
        Open cost splitting on My Checklist →
      </Button>
    ),
    "mo-sell": (
      <Button type="button" variant="link" className={taskActionBtn} onClick={() => scrollToMoveOutTier("get-it-gone")}>
        See your options below →
      </Button>
    ),
    "mo-storage": (
      <Button type="button" variant="link" className={taskActionBtn} onClick={() => scrollToMoveOutTier("they-help")}>
        Compare storage & shipping below →
      </Button>
    ),
    "mo-photos": (
      <div className="ml-9">
        <RoomPhotoCapture />
      </div>
    ),
  };

  const total = MOVE_OUT_TASKS.length;
  const doneCount = MOVE_OUT_TASKS.filter((t) => done.has(t.id)).length;
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  const groups: { group: string; tasks: typeof MOVE_OUT_TASKS }[] = [];
  for (const t of MOVE_OUT_TASKS) {
    const last = groups[groups.length - 1];
    if (last && last.group === t.group) last.tasks.push(t);
    else groups.push({ group: t.group, tasks: [t] });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-raised sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold text-foreground sm:text-xl">{t("checklist:moveOut.checklistTitle")}</h2>
        <p className="tabular-nums text-sm text-muted-foreground">
          {t("checklist:moveOut.progress", { doneCount, total })}
        </p>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-malachite-600 transition-[width] duration-300 ease-out" // KEEP: progress bar fill (MoveOut progress system)
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-label="Logistics progress"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <div className="mt-4 space-y-4">
        {groups.map((g) => (
          <div key={g.group}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {moveOutGroupLabel(g.group, moveOutDate)}
            </p>
            <ul className="space-y-0.5">
              {g.tasks.map((t) => {
                const checked = done.has(t.id);
                return (
                  <li key={t.id}>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => toggle(t.id)}
                      aria-pressed={checked}
                      className="-mx-1 flex h-auto w-full items-center justify-start gap-3 rounded-lg px-1 py-1.5 text-left font-normal transition-colors hover:bg-accent [&_svg]:size-3.5"
                    >
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-90",
                          checked
                            ? "border-malachite-600 bg-malachite-800 text-white" // KEEP: done-checkbox filled state
                            : "border-muted-foreground/30 text-transparent",
                        )}
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-sm",
                          checked ? "text-muted-foreground line-through" : "text-foreground",
                        )}
                      >
                        {t.title}
                      </span>
                    </Button>
                    {taskActions[t.id] ?? null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// Inline "do the thing" link under a move-out task: a real action, so it composes
// <Button variant="link">, with the button box flattened back to a text run.
const taskActionBtn =
  "ml-9 h-auto p-0 text-xs font-medium text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground";

const cardShell =
  "w-full overflow-hidden rounded-xl border border-border bg-card shadow-raised transition-shadow hover:shadow-overlay";
// Now applied to a <Button variant="ghost">, so it also flattens the cva box
// (h-10/rounded-md/justify-center) and restores the 20px muted chevron that the
// base's `[&_svg]:size-4 [&_svg]:text-current` would otherwise take over.
const headerBtn =
  "flex h-auto w-full items-start justify-start gap-3 rounded-none p-4 sm:p-5 text-left font-normal transition-colors hover:bg-accent [&_svg]:size-5 [&_svg]:text-muted-foreground";

/** Move-in logistics: the phased move-in journey, with Pitt's free inbound
 *  shipping (Ship2Pitt) slotted into the "before move-in" phase. */
export function MoveInTabPanel() {
  const { university } = useUniversity();
  const [openShip2Pitt, setOpenShip2Pitt] = useState(false);

  // No curated move-in content for this school yet (e.g. CMU at activation):
  // show a coming-soon state instead of Pitt's journey, Ship2Pitt, and
  // Welcome Week schedule.
  if (!hasMoveInContent(university.slug)) {
    return (
      <div className="pb-8">
        <UniversityContentComingSoon title={`Move-in guide for ${university.shortName}`} />
      </div>
    );
  }

  const ship2PittSlot = (
    <div className="overflow-hidden rounded-xl shadow-raised ring-1 ring-border">
      <div className={cardShell}>
        <Button
          type="button"
          variant="ghost"
          className={headerBtn}
          aria-expanded={openShip2Pitt}
          onClick={() => setOpenShip2Pitt((v) => !v)}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">Ship2Pitt</h3>
              <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                Free
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Send up to 4 boxes to campus before you arrive, free via UPS
            </p>
          </div>
          {openShip2Pitt ? (
            <ChevronUp className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </Button>
        {openShip2Pitt ? (
          <div className="border-t border-border px-4 pb-4 pt-4 text-sm text-foreground sm:px-5 sm:pb-5">
            <Ship2PittWizard />
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="pb-8">
      <MoveInJourney shippingSlot={ship2PittSlot} />
    </div>
  );
}

/** Move-out: interactive checklist, then the move-out ladder (cheapest to
 *  priciest options for selling, donating, shipping, or storing), then
 *  moving help. Ladder content lives in src/data/moveOut.ts; the Pitt
 *  program wizards render as the expanded detail of their rungs. */
export function MoveOutTabPanel() {
  const { t } = useTranslation();
  const { university } = useUniversity();
  // The interactive checklist and U-Haul are school-agnostic; the move-out
  // ladder (Ship2Home, Store@Pitt, donation drives) and Don Farr are curated
  // Pitt content, so they hide for schools without an entry yet (e.g. CMU).
  const hasCuratedContent = hasMoveOutContent(university.slug);
  const { moveOutDate, inSeason, termName, source, setUserDate } = useMoveOutDate();
  const [planAhead, setPlanAhead] = useState(false);

  // Off-season (a fall student in July doesn't need an 11-task countdown):
  // rest state instead of pressure, with an opt-in to plan ahead anyway.
  if (!inSeason && !planAhead) {
    return (
      <div className="pb-8">
        <div className="rounded-xl border border-border bg-card p-6 text-center shadow-raised sm:p-8">
          <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-lg font-bold text-foreground sm:text-xl">
            {t("checklist:moveOut.offSeason.title")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {moveOutDate
              ? t("checklist:moveOut.offSeason.noteWithDate", {
                  termName: termName || t("checklist:moveOut.offSeason.yourMoveOut"),
                  date: format(moveOutDate, "EEEE, MMMM d"),
                })
              : t("checklist:moveOut.offSeason.noteGeneral")}
          </p>
          <div className="mt-5 flex flex-col items-center gap-3">
            <Button type="button" variant="outline" onClick={() => setPlanAhead(true)}>
              {t("checklist:moveOut.offSeason.planAnyway")}
            </Button>
            <label className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              {source === "user" ? t("checklist:moveOut.offSeason.yourDate") : t("checklist:moveOut.offSeason.differentDate")}
              <input
                type="date"
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground"
                value={source === "user" && moveOutDate ? format(moveOutDate, "yyyy-MM-dd") : ""}
                onChange={(e) => setUserDate(e.target.value || null)}
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8 sm:space-y-8">
      <MoveOutChecklist moveOutDate={moveOutDate} />

      {hasCuratedContent ? (
        <MoveOutFlow
          detailSlots={{
            "ship2home-wizard": <Ship2HomeWizard />,
            "storepitt-wizard": <StorePittWizard />,
          }}
        />
      ) : (
        <UniversityContentComingSoon
          title={`Move-out options for ${university.shortName}`}
          body={`We're putting together ${university.shortName}-specific selling, donating, shipping, and storage options. Check back soon.`}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">{t("checklist:moveOut.movingHelp.title")}</h2>
        <div className="space-y-3">
          {hasCuratedContent && (
          <div className="rounded-xl border border-border bg-card p-4 shadow-raised transition-shadow hover:shadow-overlay sm:p-5">
            <h3 className="text-lg font-semibold text-foreground">Don Farr</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {t("checklist:moveOut.movingHelp.donFarrDesc")}
            </p>
            <Button
              type="button"
              asChild
              variant="outline"
              className="mt-4 w-full border-border text-foreground hover:bg-accent sm:w-auto"
            >
              <a href="https://www.donfarr.com" target="_blank" rel="noopener noreferrer">
                {t("checklist:moveOut.movingHelp.getQuote")}
                <ExternalLink className="ml-2 h-4 w-4 opacity-70" aria-hidden />
              </a>
            </Button>
          </div>
          )}
          <div className="rounded-xl border border-border bg-card p-4 shadow-raised transition-shadow hover:shadow-overlay sm:p-5">
            <h3 className="text-lg font-semibold text-foreground">U-Haul</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {t("checklist:moveOut.movingHelp.uhaul")}
            </p>
            <Button
              type="button"
              asChild
              className="mt-4 w-full bg-malachite-800 font-semibold text-white hover:bg-malachite-900 sm:w-auto" // KEEP: primary CTA for U-Haul flow
            >
              <a href="https://www.uhaul.com/Locations/" target="_blank" rel="noopener noreferrer">
                {t("checklist:moveOut.movingHelp.findLocation")}
                <ExternalLink className="ml-2 h-4 w-4 opacity-90" aria-hidden />
              </a>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
