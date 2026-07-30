interface Greeting {
  message: string
  engine: string
}

const greeting: Greeting = {
  message: 'hello from ass',
  engine: navigator.userAgent,
}

console.log(greeting.message)
console.log(greeting.engine)
