export const OPENAPI_DAILY_YAML = `openapi: 3.1.0
info:
  title: US Daily Market Digest API
  version: 1.0.0
  description: >
    US market daily digest for post-market summaries and fixed poster rendering.
servers:
  - url: https://weekly-rss-daily.zeabur.app
paths:
  /health:
    get:
      operationId: getHealth
      summary: Health check
      responses:
        '200':
          description: Service health payload
  /daily/us.json:
    get:
      operationId: getUsDailyMarketDigest
      summary: Get US daily market digest JSON
      parameters:
        - in: query
          name: date
          required: true
          schema:
            type: string
            pattern: '^\\\\d{4}-\\\\d{2}-\\\\d{2}$'
          description: US market session date in YYYY-MM-DD format.
      responses:
        '200':
          description: US daily market digest payload
          content:
            application/json:
              schema:
                type: object
                required:
                  - ok
                  - reportType
                  - reportDate
                  - marketDataStatus
                  - marketSummary
                  - topStories
                  - stockNews
                  - topAiRadar
                  - earningsRadar
                  - macroCalendar
                  - nextSessionWatchlist
                  - observables
                properties:
                  ok:
                    type: boolean
                    const: true
                  reportType:
                    type: string
                    const: us_daily_market_digest
                  generatedAt:
                    type: string
                    format: date-time
                  reportDate:
                    type: string
                  marketDataStatus:
                    $ref: '#/components/schemas/MarketDataStatus'
                  sourceUrl:
                    type: string
                    format: uri
                  marketSummary:
                    type: object
                    properties:
                      indices:
                        type: array
                        items:
                          $ref: '#/components/schemas/QuoteSnapshot'
                      assets:
                        type: array
                        items:
                          $ref: '#/components/schemas/QuoteSnapshot'
                      megaCaps:
                        type: array
                        items:
                          $ref: '#/components/schemas/QuoteSnapshot'
                  topStories:
                    type: array
                    items:
                      $ref: '#/components/schemas/DailyNewsItem'
                  stockNews:
                    type: array
                    description: Individual stock news selected from US market, AI, and earnings items.
                    items:
                      $ref: '#/components/schemas/DailyNewsItem'
                  topAiRadar:
                    type: array
                    items:
                      $ref: '#/components/schemas/DailyNewsItem'
                  earningsRadar:
                    type: array
                    items:
                      $ref: '#/components/schemas/DailyNewsItem'
                  macroCalendar:
                    type: array
                    items:
                      type: object
                  nextSessionWatchlist:
                    type: array
                    items:
                      type: object
                  observables:
                    type: array
                    items:
                      type: string
  /daily/taiwan.json:
    get:
      operationId: getTaiwanDailyResearch
      summary: Get Taiwan stock research JSON
      parameters:
        - in: query
          name: days
          required: false
          schema:
            type: integer
            default: 3
        - in: query
          name: keyword
          required: false
          schema:
            type: string
      responses:
        '200':
          description: Taiwan stock research payload
          content:
            application/json:
              schema:
                type: object
  /taiwan/industry-map.json:
    get:
      operationId: getTaiwanIndustryMap
      summary: Get cached Taiwan industry map from StatementDog
      parameters:
        - in: query
          name: refresh
          required: false
          schema:
            type: boolean
      responses:
        '200':
          description: Taiwan industry map payload
          content:
            application/json:
              schema:
                type: object
  /taiwan/stock.json:
    get:
      operationId: getTaiwanStockIndustryProfile
      summary: Get Taiwan stock industry profile and related news
      parameters:
        - in: query
          name: symbol
          required: true
          schema:
            type: string
            pattern: '^\\d{4,6}$'
        - in: query
          name: days
          required: false
          schema:
            type: integer
            default: 7
      responses:
        '200':
          description: Taiwan stock industry profile payload
          content:
            application/json:
              schema:
                type: object
  /daily/us-poster.json:
    get:
      operationId: getUsDailyPosterPayload
      summary: Get fixed US daily poster payload JSON
      parameters:
        - in: query
          name: date
          required: true
          schema:
            type: string
            pattern: '^\\\\d{4}-\\\\d{2}-\\\\d{2}$'
          description: US market session date in YYYY-MM-DD format.
        - in: query
          name: translation
          required: false
          schema:
            type: string
            enum: [openrouter, none]
          description: Translation mode for poster story text.
      responses:
        '200':
          description: Fixed poster payload
          content:
            application/json:
              schema:
                type: object
                required: [ok, type, formatVersion, reportDate, marketDataStatus, canRender, poster, sourcePayload]
                properties:
                  ok:
                    type: boolean
                    const: true
                  type:
                    type: string
                    const: us_daily_poster_payload
                  formatVersion:
                    type: string
                  generatedAt:
                    type: string
                    format: date-time
                  reportDate:
                    type: string
                  marketDataStatus:
                    $ref: '#/components/schemas/MarketDataStatus'
                  canRender:
                    type: boolean
                  poster:
                    type: object
                  sourcePayload:
                    type: object
  /daily:
    get:
      operationId: getUsDailyPosterHtml
      summary: Get rendered US daily poster HTML
      parameters:
        - in: query
          name: date
          required: true
          schema:
            type: string
            pattern: '^\\\\d{4}-\\\\d{2}-\\\\d{2}$'
      responses:
        '200':
          description: Rendered poster HTML
  /daily/us:
    get:
      operationId: getUsDailyHtml
      summary: Get rendered US daily digest HTML
      parameters:
        - in: query
          name: date
          required: false
          schema:
            type: string
            pattern: '^\\\\d{4}-\\\\d{2}-\\\\d{2}$'
      responses:
        '200':
          description: Rendered daily digest HTML
components:
  schemas:
    MarketDataStatus:
      type: object
      required: [requestedDate, newYorkNow, taipeiNow, recommendedCompletedUsSessionDate, isFinal, status, message]
      properties:
        requestedDate:
          type: string
        newYorkNow:
          type: string
        taipeiNow:
          type: string
        recommendedCompletedUsSessionDate:
          type: string
        isFinal:
          type: boolean
        status:
          type: string
          enum: [final, not_final, future_date, quote_unavailable]
        message:
          type: string
    QuoteSnapshot:
      type: object
      properties:
        key:
          type: string
        label:
          type: string
        symbol:
          type: string
        kind:
          type: string
          enum: [index, asset, stock]
        price:
          type:
            - number
            - "null"
        previousClose:
          type:
            - number
            - "null"
        change:
          type:
            - number
            - "null"
        changePct:
          type:
            - number
            - "null"
        asOf:
          type:
            - string
            - "null"
        history:
          type: array
          items:
            type: object
    DailyNewsItem:
      type: object
      properties:
        source:
          type: string
        title:
          type: string
        url:
          type: string
          format: uri
        publishedAt:
          type:
            - string
            - "null"
        description:
          type: string
`;
