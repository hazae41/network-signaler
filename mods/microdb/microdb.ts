export interface Row {
  readonly [key: string]: unknown
}

export interface Orders {
  readonly [key: string]: Ordering
}

export interface Filters {
  readonly [key: string]: unknown
}

export type Ordering =
  | "ascending"
  | "descending"

export interface Order {
  readonly ascending: Row[]
  readonly descending: Row[]
}

export interface Index {
  readonly map: Map<unknown, Row[]>
}

export class MicroDB {

  readonly orderByKey = new Map<string, Order>()
  readonly indexByKey = new Map<string, Index>()

  constructor() { }

  /**
   * Find the smallest set of rows based on the orders and filters.
   */
  #smallest(orders: Orders, filters: Filters) {
    let smallest = undefined

    for (const key in filters) {
      const index = this.indexByKey.get(key)

      if (index == null)
        return []

      const rows = index.map.get(filters[key])

      if (rows == null)
        return []

      if (smallest == null || rows.length < smallest.length)
        smallest = rows
      continue
    }

    for (const key in orders) {
      const order = this.orderByKey.get(key)

      if (order == null)
        return []

      const ordered = order[orders[key]]

      if (smallest == null || ordered.length < smallest.length)
        smallest = ordered
      continue
    }

    if (smallest == null)
      return []
    return smallest
  }

  get(orders: Orders, filters: Filters) {
    const smallest = this.#smallest(orders, filters)

    return smallest.filter(row => {
      for (const key in filters)
        if (filters[key] !== row[key])
          return false
      return true
    }).sort((a, b) => {
      for (const key in orders) {
        const ax = a[key] as bigint
        const bx = b[key] as bigint

        const d = orders[key] === "ascending"
          ? ax - bx
          : bx - ax

        if (d < 0n)
          return -1
        if (d > 0n)
          return 1
      }

      return 0
    })
  }

  append(row: Row) {
    for (const key in row) {
      if (typeof row[key] === "bigint") {
        const order = this.orderByKey.get(key)

        if (order == null) {
          const ascending = [row]
          const descending = [row]

          this.orderByKey.set(key, { ascending, descending })
        } else {
          const { ascending, descending } = order

          ascending.push(row)
          ascending.sort((a, b) => {
            const ax = a[key] as bigint
            const bx = b[key] as bigint

            const d = ax - bx

            if (d < 0n)
              return -1
            if (d > 0n)
              return 1
            return 0
          })

          descending.push(row)
          descending.sort((a, b) => {
            const ax = a[key] as bigint
            const bx = b[key] as bigint

            const d = bx - ax

            if (d < 0n)
              return -1
            if (d > 0n)
              return 1
            return 0
          })
        }
      }

      {
        const index = this.indexByKey.get(key)

        if (index == null) {
          const map = new Map<unknown, Row[]>()

          const value = row[key]
          map.set(value, [row])

          this.indexByKey.set(key, { map })
        } else {
          const { map } = index

          const value = row[key]
          const rows = map.get(value)

          if (rows == null) {
            map.set(value, [row])
          } else {
            rows.push(row)
          }
        }
      }
    }
  }

  remove(row: Row) {
    for (const key in row) {
      if (typeof row[key] === "bigint") {
        const order = this.orderByKey.get(key)

        if (order != null) {
          const { ascending, descending } = order

          const i = ascending.indexOf(row)

          if (i !== -1)
            ascending.splice(i, 1)

          const j = descending.indexOf(row)

          if (j !== -1)
            descending.splice(j, 1)
        }
      }

      {
        const index = this.indexByKey.get(key)

        if (index != null) {
          const { map } = index

          const value = row[key]
          const rows = map.get(value)

          if (rows != null) {
            const i = rows.indexOf(row)

            if (i !== -1)
              rows.splice(i, 1)
          }
        }
      }
    }
  }

}