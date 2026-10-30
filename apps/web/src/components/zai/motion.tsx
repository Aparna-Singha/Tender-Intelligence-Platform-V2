"use client";

import { motion, type Variants, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";

/* ---------- Easing curves ---------- */
export const EASE = [0.22, 1, 0.36, 1] as const; // premium "ease-out-expo"
export const EASE_SOFT = [0.4, 0, 0.2, 1] as const;

/* ---------- Variants ---------- */

/** Stagger container — children fade up in sequence */
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
};

/** Fade up child — used inside staggerContainer */
export const fadeUpItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: EASE },
  },
};

/** Single fade-up (no stagger parent needed) */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.5, ease: EASE } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: EASE },
  },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  show: { opacity: 1, x: 0, transition: { duration: 0.55, ease: EASE } },
};

/* ---------- Wrapper components ---------- */

/** Page-level entrance wrapper. Drop around any screen root. */
export function PageTransition({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      transition={{ duration: 0.5, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Stagger group — wrap a list of cards/items. */
export const MotionGroup = motion.div;

/** A card that lifts on hover. */
export const HoverCard = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  function HoverCard({ children, ...props }, ref) {
    return (
      <motion.div
        ref={ref}
        whileHover={{
          y: -4,
          transition: { duration: 0.25, ease: EASE_SOFT },
        }}
        {...props}
      >
        {children}
      </motion.div>
    );
  },
);

/* ---------- Tab transition (for workspace tabs) ---------- */
export function TabTransition({
  children,
  id,
}: {
  children: ReactNode;
  id: string;
}): React.JSX.Element {
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* ---------- Reusable motion primitives ---------- */
export const MBox = motion.div;
