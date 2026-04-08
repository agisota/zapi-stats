import type { LeaderboardEntry } from './stats-service.ts';

export interface UserProfile {
  displayName: string;
  patterns: string[];
  recommendations: string[];
  highlights: string[];
}

export function generateUserProfile(entry: LeaderboardEntry, allEntries: LeaderboardEntry[]): UserProfile {
  const patterns: string[] = [];
  const recommendations: string[] = [];
  const highlights: string[] = [];

  // Rank among all users
  const rank = allEntries.findIndex(e => e.name === entry.name) + 1;
  const total = allEntries.length;

  // --- PATTERNS ---

  // Activity level
  if (entry.requestsPerDay > 500) {
    patterns.push(`Power user — ${Math.round(entry.requestsPerDay)} requests/day average`);
  } else if (entry.requestsPerDay > 100) {
    patterns.push(`Active user — ${Math.round(entry.requestsPerDay)} requests/day average`);
  } else if (entry.requestsPerDay > 10) {
    patterns.push(`Moderate user — ${Math.round(entry.requestsPerDay)} requests/day`);
  } else {
    patterns.push(`Light user — ${entry.requestsPerDay.toFixed(1)} requests/day`);
  }

  // Top model usage
  patterns.push(`Primary model: ${entry.topModel} via ${entry.topProvider}`);

  // Session behavior
  if (entry.avgSessionMessages > 100) {
    patterns.push(`Marathon sessions — avg ${entry.avgSessionMessages.toFixed(0)} messages/session`);
  } else if (entry.avgSessionMessages > 30) {
    patterns.push(`Extended sessions — avg ${entry.avgSessionMessages.toFixed(0)} messages/session`);
  } else {
    patterns.push(`Short sessions — avg ${entry.avgSessionMessages.toFixed(0)} messages/session`);
  }

  // Output ratio
  if (entry.outputRatio > 0.05) {
    patterns.push(`High output ratio (${(entry.outputRatio * 100).toFixed(1)}%) — generates substantial content`);
  } else if (entry.outputRatio < 0.005) {
    patterns.push(`Very low output ratio (${(entry.outputRatio * 100).toFixed(2)}%) — likely tool-heavy/agentic usage`);
  }

  // Peak hours
  const peakLabel = entry.peakHour >= 9 && entry.peakHour <= 17 ? 'business hours' :
    entry.peakHour >= 18 && entry.peakHour <= 23 ? 'evening' : 'night owl';
  patterns.push(`Peak activity at ${String(entry.peakHour).padStart(2, '0')}:00 (${peakLabel})`);

  // --- RECOMMENDATIONS ---

  if (entry.costPerRequest > 1.5) {
    recommendations.push(`High cost/request ($${entry.costPerRequest.toFixed(2)}) — consider Haiku or Groq for simple queries`);
  }

  if (entry.successRate < 0.8) {
    recommendations.push(`Low success rate (${(entry.successRate * 100).toFixed(1)}%) — check for rate limiting or auth issues`);
  } else if (entry.successRate < 0.9) {
    recommendations.push(`Moderate error rate (${((1 - entry.successRate) * 100).toFixed(1)}% failures) — review error patterns`);
  }

  if (entry.avgLatency > 3000) {
    recommendations.push(`High avg latency (${(entry.avgLatency / 1000).toFixed(1)}s) — consider faster providers (Groq, Cerebras)`);
  }

  if (entry.uniqueProviders === 1) {
    recommendations.push(`Single provider dependency — diversify for resilience`);
  }

  if (entry.tokensPerRequest > 100000) {
    recommendations.push(`Very large requests (${(entry.tokensPerRequest / 1000).toFixed(0)}K tok/req) — consider chunking or summarization`);
  }

  if (entry.tokensCacheRead === 0 && entry.requests > 100) {
    recommendations.push(`No cache utilization — enable prompt caching to reduce costs`);
  }

  if (recommendations.length === 0) {
    recommendations.push('Usage patterns look healthy — no specific recommendations');
  }

  // --- HIGHLIGHTS ---

  // Compare against all users
  const maxRequests = Math.max(...allEntries.map(e => e.requests));
  const maxCost = Math.max(...allEntries.map(e => e.cost));
  const maxDiversity = Math.max(...allEntries.map(e => e.providerDiversity));
  const maxModels = Math.max(...allEntries.map(e => e.uniqueModels));
  const bestSuccessRate = Math.max(...allEntries.map(e => e.successRate));
  const lowestLatency = Math.min(...allEntries.filter(e => e.avgLatency > 0).map(e => e.avgLatency));

  if (entry.requests === maxRequests) highlights.push('Most active user by request count');
  if (entry.cost === maxCost) highlights.push('Highest total API spend');
  if (entry.providerDiversity === maxDiversity) highlights.push('Most diverse provider usage');
  if (entry.uniqueModels === maxModels) highlights.push('Uses the most different models');
  if (entry.successRate === bestSuccessRate && entry.requests > 50) highlights.push('Highest success rate');
  if (entry.avgLatency === lowestLatency && entry.requests > 50) highlights.push('Fastest average response time');

  if (rank <= 3) highlights.push(`Ranked #${rank} of ${total} users`);

  if (entry.longestSessionMessages > 500) {
    highlights.push(`Longest session: ${entry.longestSessionMessages.toLocaleString()} messages`);
  }

  if (entry.activeDays >= 14) {
    highlights.push(`Active ${entry.activeDays} days — consistent daily usage`);
  }

  return {
    displayName: entry.displayName,
    patterns,
    recommendations,
    highlights,
  };
}
