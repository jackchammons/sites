import { esc, nameLink, shortDate } from '../html.mjs';
import { locationLabel } from '../../src/locations.js';

export function bracketsSection(ctx) {
  const { dataset, now, ranked, restScored, allScored, scoredAll, buzz, entriesById, week, weekKey, history } = ctx;
  const { brackets } = ctx;
const bracketCard = ({ group, list }) => {
  const w = list[0];
  const rest = list.slice(1, 3);
  return `
        <div class="bracket">
          <div class="bracket-head">
            <h3>${esc(group)}</h3>
            <span>${list.length === 1 ? 'unopposed' : `${list.length} contenders`}</span>
          </div>
          <div class="bracket-win">
            <span class="bracket-medal">#${w.rank}</span>
            <div>
              <strong>${nameLink(w)}</strong>
              <div class="bracket-sub">${esc(locationLabel(w))} · ${w.score.toFixed(1)} SLICE</div>
            </div>
          </div>
          ${rest.length ? `<ul class="bracket-rest">${rest.map(r =>
            `<li><span>${nameLink(r)}</span><span>${r.score.toFixed(1)}</span></li>`).join('')}</ul>` : ''}
        </div>`;
};

const bracketSection = `
<section class="section">
  <div class="wrap">
    <div class="eyebrow">By style</div>
    <h2 class="sec-h">Best of each kind</h2>
    <p class="lede" style="margin-top:14px">
      A single list compares a Chicago deep pan to a Neapolitan margherita, which is not a fair
      fight in either direction. This table answers the question people actually arrive with:
      the best of the kind you want tonight.
    </p>
    <div class="brackets">${brackets.map(bracketCard).join('')}</div>
  </div>
</section>
`;

  return bracketSection;
}
