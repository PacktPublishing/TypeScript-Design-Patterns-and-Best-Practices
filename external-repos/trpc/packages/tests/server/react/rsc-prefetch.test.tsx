import { getServerAndReactClient } from './__reactHelpers';
import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { createHydrationHelpers } from '@trpc/react-query/rsc';
import { initTRPC } from '@trpc/server';
import { konn } from 'konn';
import React from 'react';
import { z } from 'zod';

const ctx = konn()
  .beforeEach(() => {
    // mock of React.cache deduplication
    const cache = <T extends (...args: any[]) => any>(fn: T) => {
      const cache = new Map<string, ReturnType<T>>();
      return (...args: Parameters<T>) => {
        const key = JSON.stringify(args);
        if (cache.has(key)) {
          return cache.get(key);
        }
        const result = fn(...args);
        cache.set(key, result);
        return result;
      };
    };

    const t = initTRPC.create();
    const postByIdInvokations = vi.fn();
    const appRouter = t.router({
      post: t.router({
        byId: t.procedure
          .input(
            z.object({
              id: z.string(),
            }),
          )
          .query((opts) => {
            postByIdInvokations({
              input: opts.input,
            });

            return `__result${opts.input.id}` as const;
          }),
      }),
    });

    const ctx = getServerAndReactClient(appRouter);

    const serverQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          // Since queries are prefetched on the server, we set a stale time so that
          // queries aren't immediately refetched on the client
          staleTime: 1000 * 30,
        },
        dehydrate: {
          // include pending queries in dehydration
          shouldDehydrateQuery: (query) =>
            defaultShouldDehydrateQuery(query) ||
            query.state.status === 'pending',
        },
      },
    });

    const createTRPCContext = cache(() => ({}));
    const getQueryClient = cache(() => serverQueryClient);
    const serverClient = t.createCallerFactory(appRouter)(createTRPCContext);

    const { trpc, HydrateClient } = createHydrationHelpers<typeof appRouter>(
      serverClient,
      getQueryClient,
    );

    return {
      ...ctx,
      trpc,
      HydrateClient,
      getQueryClient,
      postByIdInvokations,
    };
  })
  .afterEach(async (ctx) => {
    await ctx?.close?.();
  })
  .done();

test('rsc prefetch helpers', async () => {
  const { client, App, trpc, HydrateClient, getQueryClient } = ctx;

  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  function MyComponent() {
    const q1 = client.post.byId.useQuery({
      id: '1',
    });

    const q2 = client.post.byId.useQuery({
      id: '2',
    });

    return (
      <>
        {q1.data}
        {q2.data}
      </>
    );
  }

  // Imaginary RSC prefetch parent component
  function Parent() {
    void trpc.post.byId.prefetch({ id: '1' });
    void trpc.post.byId.prefetch({ id: '2' });
    return (
      <HydrateClient>
        <MyComponent />
      </HydrateClient>
    );
  }

  const utils1 = render(
    <App>
      <Parent />
    </App>,
  );
  await waitFor(() => {
    expect(utils1.container).toHaveTextContent('__result1');
    expect(utils1.container).toHaveTextContent('__result2');
  });
  expect(ctx.postByIdInvokations).toHaveBeenCalledTimes(2);

  // Should not have fetched from CC but taken promise from server client
  expect(fetchSpy).toHaveBeenCalledTimes(0);
});