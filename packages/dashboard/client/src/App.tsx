import { useEffect, useState } from 'react';
import type { RankedListing } from '../../../core/src/rank/rank.js';
import { formatPriceCents } from '../../../core/src/format.js';

interface ListingsResponse {
  listings: RankedListing[];
}

export default function App() {
  const [listings, setListings] = useState<RankedListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadListings() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/listings');
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const data = (await response.json()) as ListingsResponse;
        if (!cancelled) {
          setListings(data.listings);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load listings');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadListings();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p>Loading listings...</p>;
  }

  if (error) {
    return <p role="alert">Error loading listings: {error}</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Source</th>
          <th>Title</th>
          <th>Price</th>
          <th>Score</th>
          <th>Thumbnail</th>
        </tr>
      </thead>
      <tbody>
        {listings.map((listing) => (
          <tr key={listing.id}>
            <td>{listing.rank}</td>
            <td>{listing.source}</td>
            <td>{listing.title}</td>
            <td>{formatPriceCents(listing.priceCents)}</td>
            <td>{listing.score}</td>
            <td>
              <img
                src={`/api/images/${encodeURIComponent(listing.id)}`}
                alt={listing.title}
                width="60"
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
