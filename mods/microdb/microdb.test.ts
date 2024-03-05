import { MicroDB } from "./microdb.ts";

function randomOf<T>(array: T[]) {
  return array[Math.floor(Math.random() * array.length)]
}

// {
//   const db = new MicroDB()

//   const john = {
//     id: 1n,
//     name: "John",
//     age: 30n,
//     job: "Engineer"
//   }

//   const jane = {
//     id: 2n,
//     name: "Jane",
//     age: 30n,
//     job: "Engineer"
//   }

//   db.append(john)
//   db.append(jane)

//   console.log(db.get({ age: "ascending", id: "descending" }, { job: "Engineer" }))
// }

{
  const db = new MicroDB()

  const john = {
    id: 1n,
    name: "John",
    age: 30n,
    job: "Engineer",
    certifications: ["AWS", "Azure", "GCP"]
  }

  const jane = {
    id: 2n,
    name: "Jane",
    age: 30n,
    job: "Engineer",
    certifications: ["AWS", "Azure", "Docker"]
  }

  db.append(john)
  db.append(jane)

  console.log(db.get({ age: "ascending", id: "descending" }, { job: "Engineer", certifications: ["Docker", "GCP"] }))
}


// {
//   const db = new MicroDB()

//   const ages = [20n, 25n, 30n, 35n, 40n, 45n, 50n, 55n, 60n, 65n]
//   const jobs = ["Engineer", "Doctor", "Lawyer", "Teacher", "Pilot"]
//   const names = ["John", "Jane", "Doe", "Smith", "Brown", "Johnson", "Williams", "Miller", "Davis", "Garcia"]

//   for (let i = 0n; i < 10000n; i++) {
//     db.append({ id: i % 100n, name: randomOf(names), age: randomOf(ages), job: randomOf(jobs) })
//   }

//   const start = performance.now()
//   const result = db.get({ age: "ascending", id: "ascending" }, { job: "Engineer", name: "John" })
//   const end = performance.now()

//   console.log(result, end - start)
// }