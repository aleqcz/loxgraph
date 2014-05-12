class Graph
  constructor: (options) ->
    {@name, @div, @url} = options

  data = undefined
  graph = undefined

  loadFile: -> $.ajax { url: "/stats/#{@url}", dataType: 'xml' }

  parseXml: (xmlDoc) =>
    @data = $(xmlDoc).find('S').map ->
      timestamp = new Date($(this).attr('T'))
      value = parseFloat($(this)[0].attributes[1].value)
      [[timestamp, value]]
    .toArray()

  draw: (d) =>
    @graph = new Dygraph($("##{@div}")[0], d,
      delimiter: ';'
      digitsAfterDecimal: 3
      labels: ['Time', 'value']
      rightGap: 20
      rollPeriod: 1
      showRoller: true
      strokeWidth: 1
      title: @name
    )
    @zoomLastMinutes 1440

  create: ->
    @loadFile().then(@parseXml).then(@draw)
    @adjustWidth()
    return this

  update: ->
    @loadFile().then(@parseXml).then =>
      @graph.updateOptions file: @data

  zoomLastMinutes: (minutes=120) ->
    now = new Date().valueOf()
    intervalBegin = now - minutes * 1000 * 60
    intervalEnd   = now
    @graph.updateOptions
      dateWindow: [intervalBegin, intervalEnd]

  moveDateWindowRight: ->
    [currBegin, currEnd] = @graph.xAxisRange()

    now = new Date().valueOf()
    diff = now - currEnd

    @graph.updateOptions
      dateWindow: [currBegin + diff, currEnd + diff]

  adjustWidth: ->
    $("##{@div}").width($(window).width() - $("##{@div}").css('margin').replace(/[^-\d\.]/g, '')*4)

class Stat
  @loadFile: -> $.ajax { url: '/stats', dataType: 'html' }

  @parseHtml: (htmlDoc) =>
    stats = {}
    $(htmlDoc).find('li>a').map ->
      url = $(this).attr('href')
      urlRe = /([0-9a-f-]{35})\.([0-9]{6})\.xml/
      sourceId = url.replace(urlRe, '$1')
      period = url.replace(urlRe, '$2')
      year = period.slice 0,4
      month = period.slice -2
      titleRe = /(.*) \((.*)\) [0-9]{6}/
      title = $(this).text().replace(titleRe, '$1')
      categoryAndRoom = $(this).text().replace(titleRe, '$2')
      divId = "#{sourceId}_#{year}#{month}"
      urlObj = {url, year, month, divId, selected: false}

      if sourceId of stats # CoffeeScript 'of' equals JS 'in'
        stats[sourceId].urls.push urlObj
      else
        stats[sourceId] = {title, categoryAndRoom, urls: [urlObj]}

    ractive.set stats: stats

  @go: ->
    @loadFile().then(@parseHtml)

Stat.go()

graphs = []

ractive = new Ractive
  el: 'output'
  template: '#template'
  data: graphs

ractive.on
  select: (event, url, title) ->
    kp = @get "#{event.keypath}"
    @toggle "#{event.keypath}.selected"
    if kp.selected
      graphs[kp.divId] = new Graph
        name: "#{title} #{kp.year}-#{kp.month}"
        url: kp.url
        div: kp.divId
      .create()
  refresh: (event) ->
    kp = @get "#{event.keypath}"
    graphs[kp.divId].update()
    graphs[kp.divId].moveDateWindowRight()
