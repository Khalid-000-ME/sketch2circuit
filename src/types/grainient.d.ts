/**
 * Types for the Grainient component, which ships from its registry as untyped
 * JSX. Without this, TypeScript infers the prop types from the defaults in the
 * source and treats the two props that have no default — `dpr` and `style` — as
 * required, so every call site has to pass them.
 */
declare module '@/components/Grainient' {
  import type { ComponentType, CSSProperties } from 'react';

  export interface GrainientProps {
    colors?: string[];
    type?: 'linear' | 'radial';
    angle?: number;
    bands?: number;
    speed?: number;
    flow?: number;
    scale?: number;
    softness?: number;
    silk?: number;
    grainAmount?: number;
    grainSize?: number;
    grainAnimated?: boolean;
    contrast?: number;
    saturation?: number;
    variation?: number;
    interactive?: boolean;
    stir?: number;
    clickSwirl?: boolean;
    intro?: boolean;
    lightMode?: boolean;
    dpr?: number;
    className?: string;
    style?: CSSProperties;
  }

  const Grainient: ComponentType<GrainientProps>;
  export default Grainient;
}
