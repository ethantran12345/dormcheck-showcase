import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { PageHead, WRAP } from "@/components/marketing/landing/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fieldErrorProps } from "@/lib/formCraft";
import { FieldError } from "@/components/ui/field-error";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";

/**
 * /feedback (marketing site): a public help/feedback form for students and
 * visitors. Posts straight to /api/contact with kind:'support', which emails
 * support@dormcheck.com - no mailto, no second step. Mirrors the Partners
 * inquiry form; on a rare send failure it shows an optional prefilled email
 * link but never auto-opens the mail app.
 */

const SUPPORT_EMAIL = "support@dormcheck.com";
const CATEGORIES = ["Question", "Bug", "Idea", "Other"];

const inputCls =
  "w-full rounded-[11px] border border-stone-900/15 bg-white px-3.5 py-3 text-[15px] text-stone-900 transition-shadow focus:border-malachite-600 focus:outline-none focus:ring-2 focus:ring-malachite-600/25";

function buildMailto(f: { name: string; email: string; category: string; message: string }) {
  const subject = `DormCheck help & feedback: ${f.category || f.name}`;
  const body = `Name: ${f.name}\nEmail: ${f.email}\nCategory: ${f.category}\n\nMessage:\n${f.message}\n`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function FeedbackForm() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  /**
   * IPP-3 form craft. This form is UNCONTROLLED (it reads FormData on submit) and
   * rebuilding it as controlled state is an explicit non-goal, so validation reads
   * the value off the event instead of mirroring it into React. Errors are stored
   * by field name, set on blur, and cleared as soon as the value becomes valid —
   * the reveal-then-track-live behaviour described in src/lib/formCraft.ts, minus
   * the need for a value in state.
   */
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({});

  const validate = (field: "name" | "email" | "message", raw: string): string | undefined => {
    const value = raw.trim();
    if (field === "name") return value ? undefined : t("common:form.nameRequired");
    if (field === "message") return value ? undefined : t("common:form.messageRequired");
    if (!value) return t("common:form.emailRequired");
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : t("common:form.emailInvalid");
  };

  /**
   * Blur reveals the error; typing only ever clears it, never introduces one.
   *
   * Both handlers read the value into a local BEFORE calling setErrors. React
   * nulls `currentTarget` once dispatch finishes, and a `setState` updater runs
   * later during render — reading the event inside the updater threw
   * "Cannot read properties of null (reading 'value')" and the error boundary ate
   * the whole form. Unit tests passed; only the browser caught it.
   */
  const fieldProps = (field: "name" | "email" | "message") => ({
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const message = validate(field, e.target.value);
      setErrors((prev) => ({ ...prev, [field]: message }));
    },
    onInput: (e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const stillInvalid = validate(field, e.currentTarget.value);
      setErrors((prev) => (prev[field] && !stillInvalid ? { ...prev, [field]: undefined } : prev));
    },
    ...fieldErrorProps(`fb-${field === "message" ? "msg" : field}`, errors[field]),
  });
  // Optional prefilled link shown only if the automatic send fails. We never
  // navigate to it - clicking Send must not force-open a compose window.
  const [mailtoHref, setMailtoHref] = useState(`mailto:${SUPPORT_EMAIL}`);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const f = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      category: String(data.get("category") ?? "").trim(),
      message: String(data.get("message") ?? "").trim(),
    };
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, kind: "support" }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus("sent");
      form.reset();
    } catch {
      // Rare failure: offer a prefilled email link they can optionally use.
      // Do NOT auto-open the mail app - that reads as a forced second step.
      setMailtoHref(buildMailto(f));
      setStatus("error");
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fb-name" className="text-[13px] font-bold text-stone-600">Your name</label>
          {/* IPP-3: autoComplete so a real browser and iOS actually fill these.
              DELIBERATELY NO autoFocus: this form sits below a hero inside a
              <Reveal> animation partway down a scrolling marketing page, so
              focusing it on mount would jump the viewport past the heading the
              visitor came to read. Autofocus belongs on dedicated form surfaces
              (Auth, the post composer), not on a section of a longer page. */}
          <Input id="fb-name" name="name" type="text" autoComplete="name" placeholder="Jordan Lee" required maxLength={200} className={inputCls} {...fieldProps("name")} />
          <FieldError fieldId="fb-name" message={errors.name} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fb-email" className="text-[13px] font-bold text-stone-600">Email</label>
          <Input id="fb-email" name="email" type="email" autoComplete="email" inputMode="email" placeholder="you@school.edu" required maxLength={254} className={inputCls} {...fieldProps("email")} />
          <FieldError fieldId="fb-email" message={errors.email} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fb-category" className="text-[13px] font-bold text-stone-600">What's this about?</label>
        <select id="fb-category" name="category" className={inputCls} defaultValue={CATEGORIES[0]}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="fb-msg" className="text-[13px] font-bold text-stone-600">How can we help?</label>
        <Textarea
          id="fb-msg"
          name="message"
          required
          maxLength={5000}
          placeholder="Tell us what's on your mind - a question, a bug, or an idea..."
          className={`min-h-[130px] resize-y`}
          {...fieldProps("message")}
        />
        <FieldError fieldId="fb-msg" message={errors.message} />
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
                {SUPPORT_EMAIL}
              </a>
              .
            </>
          )}
        </span>
      </div>
    </form>
  );
}

export default function Feedback() {
  return (
    <div className="bg-tint-50 text-stone-900">
      <RouteMeta title={pageTitle("Help & feedback")} />
      <section className="pb-8 pt-8 md:pt-14">
        <div className={WRAP}>
          <PageHead eyebrow="Get in touch" title={<>Help <span className="font-sans">&</span> feedback</>}>
            Questions, bugs, or ideas: send this and it lands straight with our team. Real replies,
            usually within a day.
          </PageHead>
        </div>
      </section>

      <section className="pb-16">
        <div className={WRAP}>
          <Reveal>
            <div className="mx-auto max-w-[620px] rounded-[22px] border border-stone-900/10 bg-white p-6 shadow-raised md:p-8">
              <FeedbackForm />
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
