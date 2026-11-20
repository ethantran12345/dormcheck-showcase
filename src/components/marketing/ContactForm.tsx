import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Shared marketing contact form (extracted from Partners 2026-07-12 so
 * /for-universities can run its own pilot-inquiry form). Posts to
 * /api/contact; on failure offers a prefilled mailto link without ever
 * force-opening a compose window. `inquiryTypes` renders a select when it has
 * 2+ options; with a single entry the type is submitted silently.
 */

const inputCls =
  // rounded-control (12): this is an input, and the tier is assigned by role.
  // Was rounded-[11px] — an arbitrary radius competing with the Phase 2 scale.
  "w-full rounded-control border border-stone-900/15 bg-white px-3.5 py-3 text-[15px] text-stone-900 transition-shadow focus:border-malachite-600 focus:outline-none focus:ring-2 focus:ring-malachite-600/25";

const CONTACT_EMAIL = "partnerships@dormcheck.com";

function buildMailto(f: { name: string; email: string; org: string; type: string; message: string }) {
  const subject = `DormCheck partnership inquiry: ${f.org || f.name || f.type}`;
  const body =
    `Name: ${f.name}\nEmail: ${f.email}\nOrganization: ${f.org}\nReaching out as: ${f.type}\n\nMessage:\n${f.message}\n`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function ContactForm({
  inquiryTypes,
  orgLabel = "Organization",
  orgPlaceholder = "Your organization",
  messageLabel = "What are you looking to do?",
  messagePlaceholder = "A sentence or two on what you have in mind...",
}: {
  /** One entry = hidden fixed type; 2+ entries = visible select. */
  inquiryTypes: string[];
  orgLabel?: string;
  orgPlaceholder?: string;
  messageLabel?: string;
  messagePlaceholder?: string;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [mailtoHref, setMailtoHref] = useState(`mailto:${CONTACT_EMAIL}`);
  const showTypeSelect = inquiryTypes.length > 1;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const f = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      org: String(data.get("org") ?? "").trim(),
      type: showTypeSelect ? String(data.get("type") ?? "").trim() : inquiryTypes[0],
      message: String(data.get("message") ?? "").trim(),
    };
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus("sent");
      form.reset();
    } catch {
      setMailtoHref(buildMailto(f));
      setStatus("error");
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cf-name" className="text-[13px] font-bold text-stone-600">Your name</label>
          <Input id="cf-name" name="name" type="text" placeholder="Jordan Lee" required maxLength={200} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cf-email" className="text-[13px] font-bold text-stone-600">Email</label>
          <Input id="cf-email" name="email" type="email" placeholder="you@org.com" required maxLength={254} className={inputCls} />
        </div>
      </div>
      <div className={showTypeSelect ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cf-org" className="text-[13px] font-bold text-stone-600">{orgLabel}</label>
          <Input id="cf-org" name="org" type="text" placeholder={orgPlaceholder} maxLength={200} className={inputCls} />
        </div>
        {showTypeSelect && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cf-type" className="text-[13px] font-bold text-stone-600">I'm reaching out as a...</label>
            <select id="cf-type" name="type" className={inputCls} defaultValue={inquiryTypes[0]}>
              {inquiryTypes.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="cf-msg" className="text-[13px] font-bold text-stone-600">{messageLabel}</label>
        <Textarea
          id="cf-msg"
          name="message"
          required
          maxLength={5000}
          placeholder={messagePlaceholder}
          className={`min-h-[110px] resize-y`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          disabled={status === "sending"}
        >
          {status === "sending" ? "Sending..." : "Send message"}
        </Button>
        <span className="text-[13px] font-semibold text-stone-500" role="status">
          {status === "sent" && "Sent. Real replies, usually within a day."}
          {status === "error" && (
            <>
              Couldn&apos;t send just now. Please email{" "}
              <a
                href={mailtoHref}
                className="font-bold text-malachite-800 underline underline-offset-2 hover:text-malachite-900"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </>
          )}
        </span>
      </div>
    </form>
  );
}
