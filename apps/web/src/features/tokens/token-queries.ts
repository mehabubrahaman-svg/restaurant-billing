import type { TokenBoard } from '@restroos/contracts';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints';

export const TOKENS_KEY = ['tokens'] as const;
/** Safety net under the `token.ready` messages: new "preparing" tokens arrive this way. */
export const TOKENS_REFETCH_MS = 10_000;

export function useTokenBoard() {
  return useQuery({
    queryKey: TOKENS_KEY,
    queryFn: api.tokens.board,
    refetchInterval: TOKENS_REFETCH_MS,
    refetchIntervalInBackground: true,
  });
}

/** `token.ready`: the token moves from PREPARING to READY. */
export function markTokenReady(client: QueryClient, tokenNo: number): void {
  client.setQueryData<TokenBoard>(TOKENS_KEY, (board) =>
    board === undefined
      ? board
      : {
          ...board,
          preparing: board.preparing.filter((n) => n !== tokenNo),
          ready: board.ready.includes(tokenNo) ? board.ready : [...board.ready, tokenNo],
        },
  );
}
