declare module 'zipcodes' {
  export interface ZipCodeRecord {
    zip: string
    latitude: number
    longitude: number
    city: string
    state: string
    country: string
  }

  export function lookup(zip: string | number): ZipCodeRecord | undefined
  /** Straight-line distance in miles (rounded), or null if either ZIP is unknown. */
  export function distance(zipA: string | number, zipB: string | number): number | null
  export function toKilometers(miles: number): number
  export function toMiles(km: number): number
}
