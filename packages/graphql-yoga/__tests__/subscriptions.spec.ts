import { createSchema, createYoga, Repeater } from 'graphql-yoga'

function eventStream<TType = unknown>(source: ReadableStream<Uint8Array>) {
  return new Repeater<TType>(async (push, end) => {
    const cancel: Promise<{ done: true }> = end.then(() => ({ done: true }))
    const iterable = source[Symbol.asyncIterator]()
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await Promise.race([cancel, iterable.next()])

      if (result.done) {
        break
      }

      const values = result.value.toString().split('\n\n').filter(Boolean)
      for (const value of values) {
        if (!value.startsWith('data: ')) {
          continue
        }
        const result = value.replace('data: ', '')
        push(JSON.parse(result))
      }
    }

    iterable.return?.()
    end()
  })
}

describe('Subscription', () => {
  test('eventStream', async () => {
    const source = (async function* foo() {
      yield { hi: 'hi' }
      yield { hi: 'hello' }
      yield { hi: 'bonjour' }
    })()

    const schema = createSchema({
      typeDefs: /* GraphQL */ `
        type Subscription {
          hi: String!
        }
        type Query {
          hi: String!
        }
      `,
      resolvers: {
        Subscription: {
          hi: {
            subscribe: () => source,
          },
        },
      },
    })

    const yoga = createYoga({ schema })

    const response = await yoga.fetch('http://yoga/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify({
        query: /* GraphQL */ `
          subscription {
            hi
          }
        `,
      }),
    })

    let counter = 0

    for await (const chunk of eventStream(response.body!)) {
      if (counter === 0) {
        expect(chunk).toEqual({ data: { hi: 'hi' } })
        counter++
      } else if (counter === 1) {
        expect(chunk).toEqual({ data: { hi: 'hello' } })
        counter++
      } else if (counter === 2) {
        expect(chunk).toEqual({ data: { hi: 'bonjour' } })
        counter++
      }
    }
  })
})
