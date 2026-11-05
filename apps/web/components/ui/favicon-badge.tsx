"use client";

import { Globe } from "lucide-react";
import { domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import * as React from "react";

import { iconProxyUrl } from "@/lib/merchant-domain";
import { SPRING_FAVICON_SWAP } from "@/lib/motion";
import { cn } from "@/lib/utils";

const componentThemeClassName = "iconiq-theme";

const WWW_PREFIX_RE = /^www\./;

type FaviconResolveStatus = "idle" | "loading" | "success" | "error";

function extractDomain(input: string): string | null {
  if (!input.trim()) return null;
  try {
    const raw = input.includes("://") ? input : `https://${input}`;
    const url = new URL(raw);
    const host = url.hostname.replace(WWW_PREFIX_RE, "");
    if (host.includes(".") && host.split(".").every(Boolean)) return host;
    return null;
  } catch {
    const cleaned = input.trim().replace(WWW_PREFIX_RE, "");
    if (cleaned.includes(".") && cleaned.split(".").every(Boolean))
      return cleaned;
    return null;
  }
}

/**
 * One same-origin candidate, not the three third-party URLs this used to try.
 *
 * The browser must never request a brand icon from google/ddg directly: the set
 * of domains it asks for is the user's list of banks and merchants, and it
 * leaves from their own IP (SEC-03). /api/v1/icons fetches server-side and owns
 * the upstream fallback chain, so the retry ladder that used to live here now
 * lives there, where it is invisible to any third party.
 */
function getFaviconCandidates(domain: string, _size = 64): string[] {
  return [iconProxyUrl(domain)];
}

function getFaviconUrl(domain: string, size = 64): string {
  return getFaviconCandidates(domain, size)[0] ?? iconProxyUrl(domain);
}

/**
 * Detects the provider's generic globe, which comes back at 16x16 when it has
 * no real mark for the domain, so the caller can show its own initial instead.
 *
 * The URL test that used to gate this matched the google.com host directly.
 * Icons are now proxied through this origin, so that pattern can never match
 * and the check would silently pass every placeholder through. The size test is
 * what actually identifies the placeholder, and it works whoever served it: a
 * genuine mark is requested at 64px, so anything at 16px or under is a stand-in
 * (or the 1x1 pixel the proxy returns when every upstream failed).
 */
function isLikelyDefaultFavicon(url: string, image: HTMLImageElement): boolean {
  if (!url) return false;
  return image.naturalWidth <= 16 && image.naturalHeight <= 16;
}

function getImageSourceUrl(image: HTMLImageElement): string {
  return image.currentSrc || image.src;
}

function getInitialResolveStatus(
  domain: string | null,
  overrideUrl: string | undefined,
  website: string
): FaviconResolveStatus {
  if (overrideUrl) return "loading";
  if (!domain) return website.trim() ? "error" : "idle";
  return "loading";
}

const sizeConfig = {
  sm: {
    badge: "size-6",
    icon: 14,
    gap: "gap-1.5",
    label: "text-sm leading-none",
  },
  md: {
    badge: "size-7",
    icon: 16,
    gap: "gap-2",
    label: "text-base leading-none",
  },
  lg: {
    badge: "size-8",
    icon: 18,
    gap: "gap-2",
    label: "text-lg leading-none",
  },
} as const;

export type FaviconBadgeSize = keyof typeof sizeConfig;

export interface FaviconBadgeProps
  extends Omit<React.ComponentPropsWithoutRef<"span">, "children"> {
  /** Domain or URL used to resolve the favicon. */
  website: string;
  /** Optional label shown beside the favicon badge. */
  label?: string;
  /** Skip provider resolution and render this favicon URL directly. */
  faviconUrl?: string;
  /** @default 64 */
  faviconSize?: 16 | 32 | 64 | 128;
  /** @default md */
  size?: FaviconBadgeSize;
  badgeClassName?: string;
  labelClassName?: string;
  /** Called when a favicon URL resolves successfully. */
  onFaviconLoad?: (url: string) => void;
  /** Called when resolution fails or an override URL fails to load. */
  onFaviconError?: () => void;
}

function useLatestRef<T>(value: T) {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

function useFaviconResolver({
  domain,
  faviconSize,
  onFaviconError,
  onFaviconLoad,
  overrideUrl,
  website,
}: {
  domain: string | null;
  faviconSize: NonNullable<FaviconBadgeProps["faviconSize"]>;
  onFaviconError?: () => void;
  onFaviconLoad?: (url: string) => void;
  overrideUrl?: string;
  website: string;
}) {
  const candidates = React.useMemo(
    () => (domain ? getFaviconCandidates(domain, faviconSize) : []),
    [domain, faviconSize]
  );

  const [status, setStatus] = React.useState<FaviconResolveStatus>(() =>
    getInitialResolveStatus(domain, overrideUrl, website)
  );
  const [candidateIndex, setCandidateIndex] = React.useState(0);
  const [displayUrl, setDisplayUrl] = React.useState<string | null>(null);

  const probeImgRef = React.useRef<HTMLImageElement>(null);
  const resolveGenerationRef = React.useRef(0);
  const processedProbeRef = React.useRef<string | null>(null);
  const statusRef = useLatestRef(status);
  const candidateIndexRef = useLatestRef(candidateIndex);
  const candidatesRef = useLatestRef(candidates);
  const callbacksRef = useLatestRef({ onFaviconError, onFaviconLoad });
  const overrideUrlRef = useLatestRef(overrideUrl);

  // biome-ignore lint/correctness/useExhaustiveDependencies: faviconSize updates provider URLs and must reset probing.
  React.useEffect(() => {
    resolveGenerationRef.current += 1;
    processedProbeRef.current = null;
    setCandidateIndex(0);
    setDisplayUrl(null);
    setStatus(getInitialResolveStatus(domain, overrideUrl, website));

    return () => {
      resolveGenerationRef.current += 1;
    };
  }, [domain, faviconSize, overrideUrl, website]);

  const probeUrl = overrideUrl ?? candidates[candidateIndex] ?? null;
  const isLoading = status === "loading" && Boolean(probeUrl);
  const isSuccess = status === "success" && Boolean(displayUrl);
  const showImage = isLoading || isSuccess;
  const imageSrc = isSuccess ? displayUrl : probeUrl;
  const showError = status === "error";

  const isActiveGeneration = React.useCallback(
    (generation: number) => generation === resolveGenerationRef.current,
    []
  );

  const failResolution = React.useCallback(
    (generation: number) => {
      if (!isActiveGeneration(generation)) return;
      if (statusRef.current !== "loading") return;

      processedProbeRef.current = null;
      setDisplayUrl(null);
      setStatus("error");
      callbacksRef.current.onFaviconError?.();
    },
    [callbacksRef, isActiveGeneration, statusRef]
  );

  const advanceCandidate = React.useCallback(
    (generation: number) => {
      if (!isActiveGeneration(generation)) return;
      if (statusRef.current !== "loading") return;

      processedProbeRef.current = null;

      const nextIndex = candidateIndexRef.current + 1;

      if (nextIndex >= candidatesRef.current.length) {
        failResolution(generation);
        return;
      }

      setCandidateIndex(nextIndex);
    },
    [
      candidateIndexRef,
      candidatesRef,
      failResolution,
      isActiveGeneration,
      statusRef,
    ]
  );

  const completeProbe = React.useCallback(
    (image: HTMLImageElement, url: string, generation: number) => {
      if (!isActiveGeneration(generation)) return;
      if (statusRef.current !== "loading") return;

      const probeKey = `${generation}:${url}`;
      if (processedProbeRef.current === probeKey) return;
      processedProbeRef.current = probeKey;

      if (!overrideUrlRef.current && isLikelyDefaultFavicon(url, image)) {
        advanceCandidate(generation);
        return;
      }

      setDisplayUrl(url);
      setStatus("success");
      callbacksRef.current.onFaviconLoad?.(url);
    },
    [
      advanceCandidate,
      callbacksRef,
      isActiveGeneration,
      overrideUrlRef,
      statusRef,
    ]
  );

  const handleImageLoad = React.useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const url = getImageSourceUrl(image);

      if (!url) return;

      completeProbe(image, url, resolveGenerationRef.current);
    },
    [completeProbe]
  );

  const handleImageError = React.useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const generation = resolveGenerationRef.current;
      if (statusRef.current !== "loading") return;

      const url = getImageSourceUrl(event.currentTarget);
      const probeKey = `${generation}:${url}`;

      if (processedProbeRef.current === probeKey) return;
      processedProbeRef.current = probeKey;

      if (overrideUrlRef.current) {
        failResolution(generation);
        return;
      }

      advanceCandidate(generation);
    },
    [advanceCandidate, failResolution, overrideUrlRef, statusRef]
  );

  React.useLayoutEffect(() => {
    if (!(isLoading && probeUrl)) return;

    const image = probeImgRef.current;
    if (!image?.complete) return;

    const generation = resolveGenerationRef.current;
    const url = getImageSourceUrl(image);
    if (!url) return;

    if (image.naturalWidth > 0) {
      completeProbe(image, url, generation);
      return;
    }

    handleImageError({
      currentTarget: image,
    } as React.SyntheticEvent<HTMLImageElement>);
  }, [completeProbe, handleImageError, isLoading, probeUrl]);

  return {
    handleImageError,
    handleImageLoad,
    imageSrc,
    isLoading,
    isSuccess,
    probeImgRef,
    showError,
    showImage,
    status,
  };
}

const FaviconBadge = React.forwardRef<HTMLSpanElement, FaviconBadgeProps>(
  function FaviconBadge(
    {
      website,
      label,
      faviconUrl,
      faviconSize = 64,
      size = "md",
      className,
      badgeClassName,
      labelClassName,
      onFaviconLoad,
      onFaviconError,
      ...props
    },
    ref
  ) {
    const overrideUrl = React.useMemo(
      () => faviconUrl?.trim() || undefined,
      [faviconUrl]
    );
    const domain = React.useMemo(() => extractDomain(website), [website]);

    const {
      handleImageError,
      handleImageLoad,
      imageSrc,
      isLoading,
      isSuccess,
      probeImgRef,
      showError,
      showImage,
      status,
    } = useFaviconResolver({
      domain,
      faviconSize,
      onFaviconError,
      onFaviconLoad,
      overrideUrl,
      website,
    });

    const config = sizeConfig[size];
    const reduceMotion = useReducedMotion() === true;
    const accessibleLabel = label ?? domain ?? website;

    return (
      <LazyMotion features={domAnimation} strict>
        <span
        aria-busy={isLoading || undefined}
        className={cn(
          componentThemeClassName,
          "inline-flex items-center",
          label ? config.gap : undefined,
          className
        )}
        ref={ref}
        {...props}
      >
        <span
          aria-hidden
          className={cn(
            "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted p-1 outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
            showError && "outline-destructive/30 dark:outline-destructive/30",
            config.badge,
            badgeClassName
          )}
          data-favicon-status={status}
        >
          {showImage && imageSrc ? (
            <>
              {/* biome-ignore lint/performance/noImgElement: external favicon URLs are resolved at runtime and must stay framework-agnostic. */}
              <m.img
                alt=""
                animate={
                  reduceMotion
                    ? undefined
                    : isSuccess
                    ? { opacity: 1, scale: 1 }
                    : { opacity: 0, scale: 0.96 }
                }
                className="relative z-[1] size-full rounded-full object-contain"
                decoding="async"
                fetchPriority="low"
                height={config.icon}
                initial={false}
                key={imageSrc}
                loading="lazy"
                onError={isLoading ? handleImageError : undefined}
                onLoad={isLoading ? handleImageLoad : undefined}
                ref={isLoading ? probeImgRef : undefined}
                referrerPolicy="no-referrer"
                src={imageSrc}
                transition={reduceMotion ? { duration: 0 } : SPRING_FAVICON_SWAP}
                width={config.icon}
              />
              {isLoading ? (
                <span
                  aria-hidden
                  className="absolute inset-0 z-[2] rounded-full bg-muted-foreground/15"
                >
                  <span className="block size-full animate-pulse rounded-full bg-muted-foreground/20 motion-reduce:animate-none" />
                </span>
              ) : null}
            </>
          ) : (
            <span
              className={cn(
                "flex size-full items-center justify-center",
                showError ? "text-muted-foreground/70" : "text-muted-foreground"
              )}
            >
              <Globe style={{ width: config.icon, height: config.icon }} />
            </span>
          )}
        </span>

        {label ? (
          <span
            className={cn(
              "font-medium text-foreground",
              config.label,
              labelClassName
            )}
          >
            {label}
          </span>
        ) : (
          <span className="sr-only">{accessibleLabel}</span>
        )}
        </span>
      </LazyMotion>
    );
  }
);

FaviconBadge.displayName = "FaviconBadge";

export {
  FaviconBadge,
  extractDomain,
  getFaviconCandidates,
  getFaviconUrl,
  isLikelyDefaultFavicon,
};
export default FaviconBadge;
