/**
 * Branded numeric unit types.
 *
 * Brands are compile-time only (zero runtime cost). They exist to stop the
 * most common class of geometry bug in this codebase: passing degrees where
 * radians are expected, or metres where kilometres are expected.
 *
 * Convention: internal trigonometry uses Radians; public/presentation APIs
 * use Degrees. Distances are Meters unless a name ends in `Km`.
 */

export type Degrees = number & { readonly __brand: 'degrees' }
export type Radians = number & { readonly __brand: 'radians' }
export type Meters = number & { readonly __brand: 'meters' }
export type Millimeters = number & { readonly __brand: 'millimeters' }

export const deg = (value: number): Degrees => value as Degrees
export const rad = (value: number): Radians => value as Radians
export const m = (value: number): Meters => value as Meters
export const mm = (value: number): Millimeters => value as Millimeters

const DEG_PER_RAD = 180 / Math.PI
const RAD_PER_DEG = Math.PI / 180

export const toRadians = (d: Degrees): Radians => (d * RAD_PER_DEG) as Radians
export const toDegrees = (r: Radians): Degrees => (r * DEG_PER_RAD) as Degrees
