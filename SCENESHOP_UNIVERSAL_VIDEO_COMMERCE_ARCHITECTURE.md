# Technical Architecture & Solution Design: Universal Video Commerce Platform
**Document Title:** Hybrid Video Recognition & Just-In-Time Commerce Architecture  
**Target Audience:** Client Executive Team, Technical Stakeholders, Product Leadership  
**Status:** Architecture Proposal & Specification  
**Version:** 1.0  

---

## 1. Executive Summary

### 1.1 The Business Objective
The client’s objective is to deliver an "invisible commerce layer" for audiovisual content: a seamless viewer experience where **any video playing on any screen** (Smart TV, PC, YouTube, Instagram, Netflix, or cinema) allows the viewer’s mobile device to synchronize and display interactive, shoppable products in real time.

### 1.2 The Core Scaling Challenge
A traditional video indexing approach would require downloading, storing, and running AI vision on **millions or crores of videos** in advance. This strategy is economically unviable and technically flawed due to:
* **Exhibitive Storage & Ingestion Costs:** Storing and constantly updating petabytes of third-party video.
* **Wasted Compute:** Over 90% of random internet videos have no shoppable intent or commercial conversion value.
* **Copyright & Platform Restrictions:** Scraping video files at massive scale triggers rate-limits and copyright violations.

### 1.3 The Recommended Solution: Dual-Track Hybrid Architecture
Instead of attempting to pre-index the entire internet, we adopt a **Dual-Track Hybrid Model** that balances instant, high-precision synchronization for known content with flexible, zero-storage visual and URL fallbacks for unknown content:

```
                              USER WANTS TO BUY FROM A VIDEO
                                            │
                ┌───────────────────────────┴───────────────────────────┐
                ▼                                                       ▼
    [ TRACK A: KNOWN CONTENT ]                              [ TRACK B: UNKNOWN CONTENT ]
     (Registered in SceneShop)                               (Not in Database / External)
                │                                                       │
     Acoustic Sync / QR Code                                  How to solve this?
                │                                                       │
     Instant Scene Products                                ┌────────────┴────────────┐
                                                           ▼                         ▼
                                                    [ SOLUTION 1 ]            [ SOLUTION 2 ]
                                                 Snap & Search Camera      Just-In-Time URL AI
                                                   (Visual Search)          (On-Demand Scraping)
```

---

## 2. Track A: Known & Partner Content (Instant Acoustic Sync)

Track A handles all content officially onboarded by creators, brands, production houses, or community curators.

### 2.1 Workflow & Technology Stack
1. **Producer Ingestion (One-Time Setup):**
   * The content owner uploads the video master once to **SceneShop Studio**.
   * **Google Gemini 1.5 Multimodal AI** scans the timeline, detects scene cuts, and tags products automatically (`server/ai.js`).
   * SceneShop extracts a mono 16 kHz audio stream and automatically registers the acoustic fingerprint in **ACRCloud** (`server/acr.js`).
   * The video file can then be deleted according to retention policy—only the lightweight fingerprint and metadata are retained.

2. **Viewer Execution Flow:**
   * The viewer watches the video on their TV, PC, or cinema screen.
   * The viewer opens the **SceneShop Mobile App** and taps **"Listen & Sync"**.
   * The mobile app records 5–10 seconds of ambient audio via the device microphone.
   * ACRCloud matches the acoustic fingerprint and returns the exact Work ID and timestamp offset (e.g., `00:04:18`).
   * The mobile companion displays the curated product cards for that exact scene within **1.8 to 2.5 seconds**.

---

## 3. Track B: Unknown & Unregistered Content

When a viewer watches a video that has **never been uploaded or tagged** by anyone, the platform prevents dead ends by offering two intelligent resolution paths.

---

### Solution 1: "Snap & Search" Camera Visual Fallback (Google Lens Model)

#### Why This Works
Instead of indexing **crores of videos**, this approach indexes **products directly**. A user does not need the video to exist in our database; they only need the visual product identified.

#### Architecture & Flow
```
[Viewer watching un-registered video on TV]
                    │
                    ▼
[Microphone fails to find audio match]
                    │
                    ▼
[App prompts: "Content not indexed yet. Snap the screen!"]
                    │
                    ▼
[User takes a photo of the actor's clothing/watch with phone camera]
                    │
                    ▼
[Google Gemini Multimodal Vision API / Google Cloud Vision]
  • Crops the bounding box of the item
  • Extracts style, color, pattern, brand indicators, and category
                    │
                    ▼
[Affiliate & E-Commerce Catalog Resolver]
  • Queries Amazon Product API, Google Shopping, Zara, or partner catalogs
  • Generates monetized affiliate links
                    │
                    ▼
[Shoppable product cards displayed on mobile in under 2 seconds]
```

#### Key Technical Advantages
* **Zero Video Storage Required:** The platform stores no video files whatsoever.
* **100% Universal Coverage:** Works on live broadcasts, old movies, TikToks, or YouTube clips without prior registration.
* **High Conversion Intent:** When a user actively takes a photo of an item, purchase intent is significantly higher than passive browsing.

---

### Solution 2: "Just-In-Time" URL Processing (On-Demand AI Ingest)

#### Why This Works
Instead of crawling millions of YouTube videos that nobody will ever watch on our platform, we only process videos that **real users explicitly request**.

#### Architecture & Flow
1. **Share-to-Shop Trigger:**
   * The user is watching a video on YouTube or Instagram.
   * They tap the native **Share** button on their phone and select **SceneShop** (handled natively in Android via `Intent.ACTION_SEND` in `MainActivity.kt`).
2. **Cache Verification:**
   * The backend checks if the URL (`https://youtu.be/...`) has already been analyzed.
   * If yes: Opens the shoppable timeline immediately.
3. **On-Demand AI Ingestion Pipeline:**
   * If no: An asynchronous worker is dispatched:
     * Downloads keyframes and audio stream from the public URL.
     * Generates the ACRCloud audio fingerprint for future users.
     * Sends the visual frames to **Google Gemini 1.5 Flash** with the prompt: *"Identify commercial fashion, electronics, and decor items per scene cut."*
     * Matches detected items against affiliate catalogs (Amazon, Mercado Livre, Shopify).
     * Publishes a versioned **Community Track**.
4. **Organic Library Growth:**
   * The video is now permanently indexed. Any other user watching that video worldwide will now get an **instant match via Track A**.

---

## 4. Technical Comparison of Approaches

| Metric | Pre-Indexing Crores of Videos (Traditional) | Dual-Track Hybrid Model (Proposed) |
| :--- | :--- | :--- |
| **Video Storage Footprint** | Petabytes ($100,000s/mo in cloud storage) | **Zero video storage** (only lightweight metadata & fingerprints) |
| **Initial Cloud Compute Cost** | Massive GPU/API cluster needed upfront | **Pay-per-use** (AI only runs when a user interacts) |
| **Copyright & Legal Risk** | High (scraping & storing third-party media) | **Zero** (analyzes public streams on-demand or user-submitted photos) |
| **Coverage Scope** | Limited to whatever was pre-crawled | **Universal** (any video via Camera Snap or URL share) |
| **Time-to-Market** | Months/Years of crawl infrastructure | **Immediate** (enhances existing SceneShop codebase) |

---

## 5. System Architecture & Component Mapping

The existing SceneShop repository provides the direct foundation for this architecture:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT PRESENTATION LAYER                       │
│  • Android Native Bridge (MainActivity.kt - Audio, Camera, Share Sheet)│
│  • Web Companion UI (public/js/mobile.js, public/css/mobile.css)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     ROUTING & ORCHESTRATION LAYER                      │
│  • Session & Realtime Manager (server/distribution.js, realtime/)      │
│  • Fingerprint & Fallback Router (public/js/companion-sync.js)         │
└───────────────────┬───────────────────────────────┬────────────────────┘
                    │                               │
        Track A: Known Content           Track B: Unknown Content
                    │                               │
                    ▼                               ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│        ACOUSTIC ENGINE               │  │       AI VISION ENGINE       │
│  • ACRCloud Cloud API                │  │  • Google Gemini 1.5 Flash   │
│  • Audio Fingerprint (server/acr.js) │  │  • Visual Search / Camera Snap│
└───────────────────┬──────────────────┘  └──────────────┬───────────────┘
                    │                                    │
                    └─────────────────┬──────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     COMMERCE & ATTRIBUTION LAYER                       │
│  • Multi-Tier Tracks (Official vs. Community) (server/tracks.js)       │
│  • Commercial Policy & Commission Splitter (server/commercial-policy.js│
│  • Affiliate Deep-Link Resolver (server/commerce.js)                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation Roadmap

### Phase 1: Production Hardening of Track A (Weeks 1–2)
* Finalize ACRCloud automated registration on media upload.
* Validate Android native microphone permissions and latency under 2 seconds.
* Deploy PostgreSQL multi-tenant state and Redis session clustering.

### Phase 2: Snap & Search Visual Fallback (Weeks 3–4)
* Add camera capture interface to Android APK and Mobile Web companion.
* Implement Google Gemini Vision / Cloud Vision object cropping endpoint (`/api/vision/search`).
* Integrate affiliate catalog search API (Amazon Product Advertising API / Google Shopping).

### Phase 3: Just-In-Time URL Ingestion Engine (Weeks 5–6)
* Wire Android `ACTION_SEND` YouTube/Instagram URL handler to on-demand queue.
* Implement background worker with Gemini 1.5 Flash video parsing.
* Enable automated community track publishing with user notifications.

---

## 7. Recommendation for Client Presentation

1. **Reassure the Client:** Clarify that trying to download and index crores of videos is an anti-pattern. No successful tech company operates this way.
2. **Highlight Commercial Feasibility:** Demonstrating that **90% of revenue comes from top partner shows and influencers** justifies starting with Track A.
3. **Showcase Innovation:** The combination of **Acoustic Sync + Visual Snap Search** gives the impression of 100% universal compatibility to the end-user, without the astronomical infrastructure costs.
