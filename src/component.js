/**
 * @file
 * Contains extraction implementations related to components.
 */

const { compare } = require('specificity')

/**
 * Returns an array representing individual extraction run contexts that compose
 * any 'components' field contents encountered during the recursive extraction
 * process.
 */
const getExtractionContexts = (o) => {
  const { extractor, pageWorker, main } = o
  const contexts = []

  // Debug.
  // console.log(`getExtractionContexts() : ${extractor.as}`)

  // TODO evaluate wildcards for doing things like :
  //  "extract": "components.nested"
  // which could contain e.g. only selector overrides based on the "base"
  // extractors (components).
  if (!('components' in main.config)) {
    throw Error('Missing components definition for selector : ' + extractor.selector)
  }

  for (let i = 0; i < main.config.components.length; i++) {
    // const componentExtractor = main.config.components[i]
    const componentExtractor = { ...main.config.components[i] }
    // const [thing, type, prop] = extractor.as.split('.')
    const [thing, type, prop] = componentExtractor.as.split('.')

    // Debug.
    // console.log(componentExtractor.as)

    // For components having a single prop to extract, e.g. :
    //  "as": "component.Lede.text"
    // we can handle these in a single run.
    // Otherwise, the "extract" key contains an array of sub-extractors which
    // must all run on the same component object.
    if (!Array.isArray(componentExtractor.extract)) {
      // Debug.
      // console.log('  Single extractor component definition')

      contexts.push({
        extractor: componentExtractor,
        parentExtractor: extractor,
        pageWorker,
        main,
        fieldOverride: prop,
        type,
        props: prop
      })
    } else {
      // We need to regroup sub-extractors to differenciate fields containing
      // multiple values (each value requiring its own extractor run) from
      // simpler ones (that can be dealt with in a single run).
      const regroupedExtractors = {}

      // while (componentExtractor.extract.length) {
      //   const subExtractor = componentExtractor.extract.shift()
      for (let j = 0; j < componentExtractor.extract.length; j++) {
        const subExtractor = componentExtractor.extract[j]
        const destination = subExtractor.as.split('.')
        let groupBy = destination[2]

        if (destination[2].indexOf('[]') !== false) {
          groupBy = destination[2].replace('[]', '')
        }
        if (!(groupBy in regroupedExtractors)) {
          regroupedExtractors[groupBy] = []
        }

        regroupedExtractors[groupBy].push(subExtractor)
      }

      // For example, at this stage, we would have something like :
      //  regroupedExtractors = {
      //    items: [
      //      { as : 'component.MediaGrid.items[].image', ... <rest of extractor definition> },
      //      { as : 'component.MediaGrid.items[].title', ... <rest of extractor definition> },
      //      { as : 'component.MediaGrid.items[].text', ... <rest of extractor definition> }
      //    ],
      //    variant: [
      //      { as : 'component.MediaGrid.variant', ... <rest of extractor definition> }
      //    ]
      //  }
      //
      // So now, we need to generate 1 extractor definition per prop to match
      // what is expected in the run() function :
      //
      //  -> For multi-props sub items :
      //  subExtractorForItemsProp = {
      //    selector: <Here we use the CSS selector of the scope delimiter
      //      from the grouped extractors of the sub-item if available, else
      //      we take the one from the component which then acts as the
      //      fallback scope>,
      //    extract: [
      //      { as : 'component.MediaGrid.items[].image', ... <rest of extractor definition> },
      //      { as : 'component.MediaGrid.items[].title', ... <rest of extractor definition> },
      //      { as : 'component.MediaGrid.items[].text', ... <rest of extractor definition> }
      //    ],
      //    as: 'component.MediaGrid.items'
      //  }
      //
      //  -> For single props :
      //  subExtractorForVariantProp = {
      //    selector: <use the value from 'variant' prop extractor definition>,
      //    extract: <use the value from 'variant' prop extractor definition>,
      //    as : 'component.MediaGrid.variant',
      //    ... <any other keys from 'variant' prop extractor definition, e.g. 'emit'>
      //  }
      const fields = Object.keys(regroupedExtractors)

      // Debug.
      // console.log('  Multiple extractors component definition')
      // console.log('    component fields :')
      // console.log(fields)

      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]

        // Debug.
        // console.log('    subExtractors :')
        // console.log(regroupedExtractors[field].map(e => e.as))

        const subExtractors = regroupedExtractors[field]
        let newExtractor = { as: `${thing}.${type}.${field}` }

        // Simple props have a single extractor which can be used "as is".
        // Multi-field sub-items need 1 'extract' array item per field.
        if (subExtractors.length === 1) {
          newExtractor = subExtractors.pop()

          // Avoid prepending several times the same CSS selector prefix for
          // scoping nested components.
          const scopedSelector = componentExtractor.selector + ' ' + newExtractor.selector

          if (!pageWorker.componentScopeProcessed.includes(newExtractor.selector)) {
            // Debug.
            console.log(`      Prepend component selector to ${newExtractor.selector}`)
            console.log(`        result : ${scopedSelector}`)

            newExtractor.selector = scopedSelector
            pageWorker.componentScopeProcessed.push(newExtractor.selector)
          }
        } else {
          // Selector fallback : use the component's extractor value. Then look
          // for a 'delimiter' key in child extractors if available.
          newExtractor.selector = componentExtractor.selector
          subExtractors.forEach(ex => {
            if ('delimiter' in ex) {
              newExtractor.selector = ex.delimiter
            }
          })
          newExtractor.extract = subExtractors
        }

        // Debug.
        // console.log('newExtractor :')
        // console.log(newExtractor)

        contexts.push({
          extractor: newExtractor,
          parentExtractor: extractor,
          pageWorker,
          main,
          fieldOverride: field,
          type,
          props: fields
        })
      }
    }
  }

  return contexts
}

/**
 * Transforms components extration result to match expected structure.
 *
 * Example extraction result (input) :
 *  { Lede: "<p>markup contents</p>" }
 * Expected structure (output) :
 *  { c: "Lede", props: { text: "<p>markup contents</p>" }}
 */
const transformObject = (componentEntity, type, prop) => {
  const transformedObject = {}
  transformedObject.c = type
  transformedObject.props = {}

  if (Array.isArray(prop)) {
    prop.forEach(p => {
      transformedObject.props[p] = componentEntity[p]
    })
  } else {
    transformedObject.props[prop] = componentEntity[prop]
  }

  return transformedObject
}

/**
 * TODO (wip) refactor in progress :
 * This second pass will deal with duplicates removal instead.
 *
 * (below = deprecated)
 * Runs a second extraction pass for nested components support.
 *
 * To avoid component nesting problem (e.g. ".card" inside another component
 * -> potential multiple matches from root to deepest nesting levels), we needed
 * a way to start by extracting the deepest levels first and mark the components
 * as extracted.
 *
 * This makes use of a property on the page worker instance itself which stores
 * all 'components' fields placeholder objects (which are built recursively from
 * config) in order to handle the processing in the correct order during this
 * second "pass".
 *
 * Nesting depth detection uses extractors' ancestors count, and in case of
 * equality, we compare CSS selectors specificity - after custom jQuery-like
 * syntax was converted by preprocessExtractor().
 *
 * See https://github.com/keeganstreet/specificity
 */
const runSecondPass = async (o) => {
  // const { extracted, pageWorker, main } = o
  const { pageWorker } = o

  // Debug.
  console.log('')
  console.log('second pass - pageWorker.extractionPlaceholders')
  console.log(pageWorker.extractionPlaceholders.map(p => p.context.extractor.ancestorsChain))

  // Nothing to do if no components fields were set in config.
  if (!pageWorker.extractionPlaceholders.length) {
    return
  }

  // No need to compare anything if there's only a single components field.
  if (pageWorker.extractionPlaceholders.length === 1) {
    const extractionPlaceholder = pageWorker.extractionPlaceholders.pop()
    // await componentsFieldProcess(extractionPlaceholder.context)

    // debug
    extractionPlaceholder.placeholder.test_field = 'test value'

    return
  }

  // Sort placeholders by most deeply nested then CSS selectors specificity.
  pageWorker.extractionPlaceholders.sort((a, b) => {
    // 'a' is less specific than 'b' (= less deeply nested).
    if (a.context.extractor.depth < b.context.extractor.depth) {
      return -1
    }
    // 'a' is more specific than 'b' (= nested deeper).
    if (a.context.extractor.depth > b.context.extractor.depth) {
      return 1
    }
    // Equality leads to CSS selectors specificity comparison.
    if (a.context.extractor.depth === b.context.extractor.depth) {
      return compare(a.context.extractor.selector, b.context.extractor.selector)
    }
  })

  // TODO (wip)
  console.log('runSecondPass() - sorting result :')
  console.log(pageWorker.extractionPlaceholders)
  // console.log(extracted)
}

module.exports = {
  getExtractionContexts,
  transformObject,
  runSecondPass
}
