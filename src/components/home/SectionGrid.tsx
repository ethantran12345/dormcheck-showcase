import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { gridChildVariants, gridParentVariants } from '@/lib/motion';

/**
 * Bento grid wrapper: the one grid definition dashboard pages share.
 * 2 columns on mobile/tablet (16px gutter), 4 on lg+ (20px gutter); every tile
 * spans a whole number of columns (square = 1, wide/hero = 2 via the caller's
 * span classes). Children stagger in per the dashboard motion spec.
 */
export function SectionGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={gridParentVariants}
      initial="hidden"
      animate="visible"
      className={cn('grid grid-cols-2 items-stretch gap-4 lg:grid-cols-4 lg:gap-5', className)}
    >
      {children}
    </motion.div>
  );
}

/** A tile slot inside `SectionGrid`; pass the col-span class via `className`. */
export function SectionGridItem({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <motion.div id={id} variants={gridChildVariants} className={cn('min-w-0', className)}>
      {children}
    </motion.div>
  );
}
