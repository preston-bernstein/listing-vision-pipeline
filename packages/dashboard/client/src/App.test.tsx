// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import App from './App';

const LISTINGS_FIXTURE = [
  {
    rank: 1,
    id: 'thriftly:listing-001',
    source: 'thriftly',
    title: 'Vintage Oak Bookshelf',
    priceCents: 12500,
    imagePath: 'thriftly/images/listing-001.jpg',
    score: 88,
  },
  {
    rank: 2,
    id: 'secondlook:listing-002',
    source: 'secondlook',
    title: 'Brass Floor Mirror',
    priceCents: 14500,
    imagePath: 'secondlook/images/listing-002.jpg',
    score: 72,
  },
];

/** Builds a minimal fetch Response stand-in — only what App.tsx actually reads (`.ok`, `.json()`). */
function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderCases(): void {
it('shows a loading state before the fetch resolves', async () => {
  let resolveFetch: (value: Response) => void = () => {};
  fetchMock.mockReturnValue(
    new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }),
  );

  render(<App />);
  expect(screen.getByText(/loading listings/i)).toBeTruthy();

  resolveFetch(jsonResponse({ listings: LISTINGS_FIXTURE }));
  await waitFor(() => expect(screen.queryByText(/loading listings/i)).toBeNull());
});

it('renders the expected table rows and columns once loaded', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ listings: LISTINGS_FIXTURE }));

  render(<App />);

  await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());

  for (const header of ['Rank', 'Source', 'Title', 'Price', 'Score', 'Thumbnail']) {
    expect(screen.getByText(header)).toBeTruthy();
  }

  // 1 header row + 2 data rows.
  expect(screen.getAllByRole('row')).toHaveLength(3);

  expect(screen.getByText('Vintage Oak Bookshelf')).toBeTruthy();
  expect(screen.getByText('Brass Floor Mirror')).toBeTruthy();
  expect(screen.getByText('$125.00')).toBeTruthy();
  expect(screen.getByText('$145.00')).toBeTruthy();
  expect(screen.getByText('88')).toBeTruthy();
  expect(screen.getByText('72')).toBeTruthy();
});
}

function requestCases(): void {
it('shows an error state when the fetch rejects', async () => {
  fetchMock.mockRejectedValue(new Error('network down'));

  render(<App />);

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByRole('alert').textContent).toContain('network down');
});

it('shows an error state when the fetch resolves non-ok', async () => {
  fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));

  render(<App />);

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByRole('alert').textContent).toContain('500');
});

it('never issues a mutating fetch call — every call is a plain GET', async () => {
  fetchMock.mockResolvedValue(jsonResponse({ listings: LISTINGS_FIXTURE }));

  render(<App />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());

  expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  for (const call of fetchMock.mock.calls) {
    const init = call[1] as RequestInit | undefined;
    const method = init?.method;
    // No explicit method (defaults to GET) or an explicit 'GET' — never POST/PUT/PATCH/DELETE.
    expect(method === undefined || method.toUpperCase() === 'GET').toBe(true);
  }
});
}

describe('<App />', () => {
  renderCases();
  requestCases();
});
