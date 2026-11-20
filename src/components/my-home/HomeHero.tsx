import { motion, useReducedMotion } from 'framer-motion';
import { format } from 'date-fns';

/**
 * Quiet mobile greeting for My Home. Seasonal move-in status no longer owns
 * the top of the page; personal recent activity follows this header instead.
 */
export function HomeHero({
  firstName,
}: {
  firstName: string;
}) {
  const reduceMotion = useReducedMotion();
  const todayLabel = format(new Date(), 'EEEE, MMMM d');

  return (
    <section aria-label="Welcome">
      {/* `pe-28` on the narrow phone layout keeps the
          text clear of the floating avatar/notifications pill to its right; the
          pill is gone on desktop so the reservation drops at `lg:`. */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="pe-28 lg:pe-0"
      >
        <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-tight text-foreground lg:text-4xl">
          Hey {firstName}
        </h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{todayLabel}</p>
      </motion.div>
    </section>
  );
}
