import { useEffect } from "react";
import { Link, useParams } from "wouter";
import { ArrowRight, Check, CirclePlay } from "lucide-react";
import { MarketingShell, features, solutions } from "@/components/marketing";
import { useLang } from "@/hooks/use-lang";
import { featureCopy, marketingPageCopy, solutionCopy } from "@/marketing-catalog";

function useMarketingMeta(title: string, description: string, lang: string) {
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${title}｜SellCase`;
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  }, [description, lang, title]);
}

function MissingMarketingPage({ kind }: { kind: "features" | "solutions" }) {
  const { lang } = useLang();
  const page = marketingPageCopy[lang];
  const label = kind === "features" ? page.allFeatures : page.allSolutions;

  return (
    <MarketingShell>
      <main className="sc-listing sc-not-found">
        <p>SELLCASE · 404</p>
        <h1>{page.missing}</h1>
        <span>{page.missingDescription}</span>
        <Link className="sc-cta" href={`/${kind}`}>
          {label} <ArrowRight size={17} />
        </Link>
      </main>
    </MarketingShell>
  );
}

export function FeaturesPage() {
  const { lang } = useLang();
  const page = marketingPageCopy[lang].featureIndex;
  const catalog = featureCopy[lang];

  useMarketingMeta(page.title, page.description, lang);

  return (
    <MarketingShell>
      <main className="sc-listing">
        <header>
          <p>PRODUCT · {page.eyebrow}</p>
          <h1>{page.title}<br /><em>{page.accent}</em></h1>
          <span>{page.description}</span>
        </header>
        <section className="sc-index-grid">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            const content = catalog[feature.slug];
            return (
              <Link href={`/features/${feature.slug}`} className="sc-index-card" key={feature.slug}>
                <small>0{index + 1}</small>
                <Icon />
                <h2>{content.title}</h2>
                <p>{content.description}</p>
                <b>{page.action} <ArrowRight size={16} /></b>
              </Link>
            );
          })}
        </section>
      </main>
    </MarketingShell>
  );
}

export function FeatureDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { lang } = useLang();
  const feature = features.find((item) => item.slug === slug);
  const page = marketingPageCopy[lang];
  const content = feature ? featureCopy[lang][feature.slug] : null;

  useMarketingMeta(content?.title ?? page.missing, content?.description ?? page.missingDescription, lang);

  if (!feature || !content) return <MissingMarketingPage kind="features" />;

  return (
    <MarketingShell>
      <main className="sc-detail">
        <section className="sc-detail-hero">
          <div>
            <p>{content.title} · SELLCASE</p>
            <h1>{content.headline}</h1>
            <p>{content.description}</p>
            <Link className="sc-cta" href="/admin">
              {page.build} <ArrowRight size={17} />
            </Link>
          </div>
          <aside>
            <small>SELLCASE</small>
            <div className="sc-sim-window">
              <div />
              <b>{content.title}</b>
              <span>{content.description}</span>
              <i /><i />
            </div>
          </aside>
        </section>
        <section className="sc-detail-body">
          <p className="sc-overline">{page.helps}</p>
          <h2>{content.headline}</h2>
          <div>
            {content.points.map((point) => <p key={point}><Check size={17} />{point}</p>)}
          </div>
        </section>
        <section className="sc-detail-next">
          <p>{page.continue}</p>
          <Link href="/features">{page.allFeatures} <ArrowRight size={18} /></Link>
        </section>
      </main>
    </MarketingShell>
  );
}

export function SolutionsPage() {
  const { lang } = useLang();
  const page = marketingPageCopy[lang].solutionIndex;
  const catalog = solutionCopy[lang];

  useMarketingMeta(page.title, page.description, lang);

  return (
    <MarketingShell>
      <main className="sc-listing sc-solutions">
        <header>
          <p>SOLUTIONS · {page.eyebrow}</p>
          <h1>{page.title}<br /><em>{page.accent}</em></h1>
          <span>{page.description}</span>
        </header>
        <section className="sc-solution-list">
          {solutions.map((solution, index) => {
            const content = catalog[solution.slug];
            return (
              <Link href={`/solutions/${solution.slug}`} key={solution.slug}>
                <small>0{index + 1}</small>
                <div>
                  <h2>{content.title}</h2>
                  <p>{content.description}</p>
                </div>
                <ArrowRight />
              </Link>
            );
          })}
        </section>
      </main>
    </MarketingShell>
  );
}

export function SolutionDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { lang } = useLang();
  const solution = solutions.find((item) => item.slug === slug);
  const page = marketingPageCopy[lang];
  const content = solution ? solutionCopy[lang][solution.slug] : null;

  useMarketingMeta(content?.title ?? page.missing, content?.description ?? page.missingDescription, lang);

  if (!solution || !content) return <MissingMarketingPage kind="solutions" />;

  return (
    <MarketingShell>
      <main className="sc-detail">
        <section className="sc-detail-hero sc-solution-hero">
          <div>
            <p>SELLCASE FOR</p>
            <h1>{content.headline}</h1>
            <p>{content.description}</p>
            <Link className="sc-cta" href="/admin">
              {page.build} <ArrowRight size={17} />
            </Link>
          </div>
          <aside>
            <CirclePlay size={72} />
            <span>{content.title}</span>
          </aside>
        </section>
        <section className="sc-detail-body">
          <p className="sc-overline">{page.helps}</p>
          <h2>{content.headline}</h2>
          <div>
            {content.points.map((point) => <p key={point}><Check size={17} />{point}</p>)}
          </div>
        </section>
        <section className="sc-detail-next">
          <p>{page.continue}</p>
          <Link href="/solutions">{page.allSolutions} <ArrowRight size={18} /></Link>
        </section>
      </main>
    </MarketingShell>
  );
}