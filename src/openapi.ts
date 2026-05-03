export const OPENAPI_YAML = `openapi: 3.1.0
info:
  title: Weekly RSS Middleware API
  version: 1.0.0
  description: >
    Fixed-source RSS middleware for Custom GPT weekly market reports.
    The API fetches RSS feeds, parses XML, cleans descriptions, deduplicates by normalized URL,
    and returns structured JSON. \`/sources\` and \`/weekly\` are public unless the Worker has \`API_KEY\`
    configured, in which case callers must send \`Authorization: Bearer <API_KEY>\`.
servers:
  - url: https://weekly-rss-middleware.c7351220.workers.dev
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: API Key
  schemas:
    HealthResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        service:
          type: string
        generatedAt:
          type: string
          format: date-time
      required: [ok, service, generatedAt]
    Source:
      type: object
      properties:
        name:
          type: string
        url:
          type: string
          format: uri
        enabled:
          type: boolean
        priority:
          type: integer
        sourceType:
          type: string
          enum: [official, media, research]
      required: [name, url, enabled, priority, sourceType]
    SourcesResponse:
      type: object
      properties:
        categories:
          type: object
          properties:
            crypto:
              type: array
              items:
                $ref: '#/components/schemas/Source'
            us_stocks_macro:
              type: array
              items:
                $ref: '#/components/schemas/Source'
            ai:
              type: array
              items:
                $ref: '#/components/schemas/Source'
            taiwan_stocks:
              type: array
              items:
                $ref: '#/components/schemas/Source'
          required: [crypto, us_stocks_macro, ai, taiwan_stocks]
      required: [categories]
    FeedItem:
      type: object
      properties:
        id:
          type: string
        source:
          type: string
        category:
          type: string
          enum: [crypto, us_stocks_macro, ai, taiwan_stocks]
        sourceType:
          type: string
          enum: [official, media, research]
        sourcePriority:
          type: integer
        title:
          type: string
        url:
          type: string
          format: uri
        publishedAt:
          type:
            - string
            - "null"
          format: date-time
        description:
          type: string
        rawDescription:
          type:
            - string
            - "null"
        matchedKeywords:
          type: array
          items:
            type: string
        ageHours:
          type:
            - number
            - "null"
        dateQuality:
          type: string
          enum: [ok, missing, invalid]
        reportScore:
          type: integer
        reportSignals:
          type: array
          items:
            type: string
        sourceQualityScore:
          type: integer
        corroborationScore:
          type: integer
        marketReactionScore:
          type: integer
        editorialScore:
          type: integer
        editorialSignals:
          type: array
          items:
            type: string
        topicTags:
          type: array
          items:
            type: string
        topicEntities:
          type: array
          items:
            type: string
        crossSourceCount:
          type: integer
        socialProof:
          type: integer
        eventType:
          type:
            - string
            - "null"
        majorEntity:
          type:
            - string
            - "null"
        marketTheme:
          type:
            - string
            - "null"
        clusterKey:
          type: string
      required:
        - id
        - source
        - category
        - sourceType
        - sourcePriority
        - title
        - url
        - publishedAt
        - description
        - rawDescription
        - matchedKeywords
        - ageHours
        - dateQuality
        - reportScore
        - reportSignals
        - sourceQualityScore
        - corroborationScore
        - marketReactionScore
        - editorialScore
        - editorialSignals
        - topicTags
        - topicEntities
        - crossSourceCount
        - socialProof
        - eventType
        - majorEntity
        - marketTheme
        - clusterKey
    TopicCluster:
      type: object
      properties:
        clusterKey:
          type: string
        category:
          type: string
          enum: [crypto, us_stocks_macro, ai, taiwan_stocks]
        title:
          type: string
        eventType:
          type:
            - string
            - "null"
        majorEntity:
          type:
            - string
            - "null"
        marketTheme:
          type:
            - string
            - "null"
        itemCount:
          type: integer
        sourceCount:
          type: integer
        sources:
          type: array
          items:
            type: string
        totalEditorialScore:
          type: integer
        averageEditorialScore:
          type: number
        topItemIds:
          type: array
          items:
            type: string
        topItemTitles:
          type: array
          items:
            type: string
        topicTags:
          type: array
          items:
            type: string
        topicEntities:
          type: array
          items:
            type: string
      required:
        - clusterKey
        - category
        - title
        - eventType
        - majorEntity
        - marketTheme
        - itemCount
        - sourceCount
        - sources
        - totalEditorialScore
        - averageEditorialScore
        - topItemIds
        - topItemTitles
        - topicTags
        - topicEntities
    NarrativeBundle:
      type: object
      properties:
        bundleKey:
          type: string
        title:
          type: string
        summary:
          type: string
        angle:
          type: string
        whyGrouped:
          type: string
        categories:
          type: array
          items:
            type: string
            enum: [crypto, us_stocks_macro, ai, taiwan_stocks]
        coreClusterKeys:
          type: array
          items:
            type: string
        relatedClusterKeys:
          type: array
          items:
            type: string
        clusterKeys:
          type: array
          items:
            type: string
        marketThemes:
          type: array
          items:
            type: string
        eventTypes:
          type: array
          items:
            type: string
        entities:
          type: array
          items:
            type: string
        itemCount:
          type: integer
        sourceCount:
          type: integer
        totalEditorialScore:
          type: integer
        crossCategory:
          type: boolean
        coreTopTitles:
          type: array
          items:
            type: string
        relatedTopTitles:
          type: array
          items:
            type: string
        topTitles:
          type: array
          items:
            type: string
      required:
        - bundleKey
        - title
        - summary
        - angle
        - whyGrouped
        - categories
        - coreClusterKeys
        - relatedClusterKeys
        - clusterKeys
        - marketThemes
        - eventTypes
        - entities
        - itemCount
        - sourceCount
        - totalEditorialScore
        - crossCategory
        - coreTopTitles
        - relatedTopTitles
        - topTitles
    SourceContextArticle:
      type: object
      properties:
        url:
          type: string
          format: uri
        normalizedUrl:
          type: string
          format: uri
        source:
          type:
            - string
            - "null"
        title:
          type: string
        publishedAt:
          type:
            - string
            - "null"
          format: date-time
        description:
          type: string
        leadText:
          type: string
        articleExcerpt:
          type: string
        keyParagraphs:
          type: array
          items:
            type: string
        quotedLines:
          type: array
          items:
            type: string
        numbersMentioned:
          type: array
          items:
            type: string
      required:
        - url
        - normalizedUrl
        - source
        - title
        - publishedAt
        - description
        - leadText
        - articleExcerpt
        - keyParagraphs
        - quotedLines
        - numbersMentioned
    SourceContextFailure:
      type: object
      properties:
        url:
          type: string
          format: uri
        normalizedUrl:
          type: string
          format: uri
        reason:
          type: string
        status:
          type:
            - integer
            - "null"
      required: [url, normalizedUrl, reason, status]
    SourceContextResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        generatedAt:
          type: string
          format: date-time
        params:
          type: object
          properties:
            urls:
              type: array
              items:
                type: string
                format: uri
            maxParagraphs:
              type: integer
          required: [urls, maxParagraphs]
        articles:
          type: array
          items:
            $ref: '#/components/schemas/SourceContextArticle'
        failedArticles:
          type: array
          items:
            $ref: '#/components/schemas/SourceContextFailure'
      required: [ok, generatedAt, params, articles, failedArticles]
    FailedFeed:
      type: object
      properties:
        source:
          type: string
        category:
          type: string
          enum: [crypto, us_stocks_macro, ai, taiwan_stocks]
        url:
          type: string
          format: uri
        reason:
          type: string
        status:
          type:
            - integer
            - "null"
      required: [source, category, url, reason, status]
    WeeklyResponse:
      type: object
      properties:
        ok:
          type: boolean
          const: true
        generatedAt:
          type: string
          format: date-time
        params:
          type: object
          properties:
            days:
              type: integer
            limitPerSource:
              type: integer
            includeTaiwan:
              type: boolean
            categories:
              type: array
              items:
                type: string
                enum: [crypto, us_stocks_macro, ai, taiwan_stocks]
            keyword:
              type:
                - string
                - "null"
            maxItemsPerCategory:
              type: integer
          required:
            - days
            - limitPerSource
            - includeTaiwan
            - categories
            - keyword
            - maxItemsPerCategory
        summary:
          type: object
          properties:
            totalItems:
              type: integer
            successfulFeeds:
              type: integer
            failedFeeds:
              type: integer
          required: [totalItems, successfulFeeds, failedFeeds]
        categories:
          type: object
          properties:
            crypto:
              type: array
              items:
                $ref: '#/components/schemas/FeedItem'
            us_stocks_macro:
              type: array
              items:
                $ref: '#/components/schemas/FeedItem'
            ai:
              type: array
              items:
                $ref: '#/components/schemas/FeedItem'
            taiwan_stocks:
              type: array
              items:
                $ref: '#/components/schemas/FeedItem'
          required: [crypto, us_stocks_macro, ai, taiwan_stocks]
        topicClusters:
          type: array
          items:
            $ref: '#/components/schemas/TopicCluster'
        narrativeBundles:
          type: array
          items:
            $ref: '#/components/schemas/NarrativeBundle'
        failedFeeds:
          type: array
          items:
            $ref: '#/components/schemas/FailedFeed'
      required: [ok, generatedAt, params, summary, categories, topicClusters, narrativeBundles, failedFeeds]
paths:
  /health:
    get:
      operationId: getHealth
      summary: Health check
      responses:
        '200':
          description: Worker is alive
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HealthResponse'
  /sources:
    get:
      operationId: getSources
      summary: List built-in RSS sources
      description: Public unless the Worker has \`API_KEY\` configured.
      responses:
        '200':
          description: Source registry
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SourcesResponse'
        '401':
          description: Unauthorized
  /weekly:
    get:
      operationId: getWeeklyFeed
      summary: Fetch recent feed items grouped by category
      description: Public unless the Worker has \`API_KEY\` configured.
      parameters:
        - in: query
          name: days
          schema:
            type: integer
            default: 7
            minimum: 1
            maximum: 30
          description: Keep items from the last N days.
        - in: query
          name: limitPerSource
          schema:
            type: integer
            default: 10
            minimum: 1
            maximum: 50
          description: Max RSS items parsed from each source before filtering.
        - in: query
          name: includeTaiwan
          schema:
            type: boolean
            default: false
          description: Include Taiwan stocks feeds when true.
        - in: query
          name: categories
          schema:
            type: string
            example: crypto,us_stocks_macro,ai
          description: Comma-separated category list.
        - in: query
          name: keyword
          schema:
            type: string
          description: Filter by keyword match in title or cleaned description.
        - in: query
          name: maxItemsPerCategory
          schema:
            type: integer
            default: 30
            minimum: 1
            maximum: 100
          description: Max items returned for each category after dedupe and sorting.
      responses:
        '200':
          description: Weekly RSS payload
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/WeeklyResponse'
        '401':
          description: Unauthorized
  /source-context:
    get:
      operationId: getSourceContext
      summary: Fetch deeper article context for selected source URLs
      description: Only accepts URLs from the fixed-source registry already used by this Worker.
      parameters:
        - in: query
          name: url
          schema:
            type: string
            format: uri
          description: Repeat this parameter for multiple article URLs.
        - in: query
          name: urls
          schema:
            type: string
          description: Comma-separated article URLs. Use either repeated url params or this field.
        - in: query
          name: maxParagraphs
          schema:
            type: integer
            default: 6
            minimum: 3
            maximum: 12
          description: Maximum number of extracted article paragraphs per URL.
      responses:
        '200':
          description: Deeper source context payload
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SourceContextResponse'
        '400':
          description: Missing URLs
        '401':
          description: Unauthorized
`;
