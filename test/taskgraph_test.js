const {TaskGraph} = require('../src/taskgraph');
const assume = require('assume');
const {Readable} = require('stream');
const Observable = require('zen-observable');

const delayTask = ({delay, ...task}) => {
  task.run = async (requirements, provide) => {
    await new Promise(resolve => setTimeout(resolve, delay));
    const res = {};
    for (const k of task.provides) {
      res[k] = true;
    }
    return res;
  };
  return task;
};

class FakeRenderer {
  constructor() {
    this.updates = [];
  }

  start(nodes) {
    this.updates.push('start');
  }

  stop(nodes) {
    this.updates.push('stop');
  }

  update(node, change, value) {
    if (change === 'status' || change === 'step') {
      value = JSON.stringify(value);
    }
    this.updates.push(`${change} ${value} ${node.task.title}`);
  }
}

suite('src/taskgraph.js', function() {
  suite('TaskGraph', function() {
    // delays here serve to order the execution of parallel tasks
    const nodes = [
      delayTask({title: 'D1', requires: [], provides: ['1'], delay: 1}),
      delayTask({title: 'D2', requires: ['1'], provides: ['2', '3'], delay: 1}),
      delayTask({title: 'D3', requires: ['1'], provides: ['4', '5'], delay: 10}),
      delayTask({title: 'D4', requires: ['3', '4'], provides: ['6'], delay: 1}),
      delayTask({title: 'D5', requires: ['4', '6'], provides: ['7'], delay: 1}),
    ];

    test('executes a graph', async function() {
      const renderer = new FakeRenderer();
      const graph = new TaskGraph(nodes, {renderer});
      await graph.run();
      assume(renderer.updates).to.deeply.equal([
        'start',
        'state running D1',
        'state finished D1',
        'state running D2',
        'state running D3',
        'state finished D2',
        'state finished D3',
        'state running D4',
        'state finished D4',
        'state running D5',
        'state finished D5',
        'stop',
      ]);
    });

    suite('utils.skip', function() {
      test('skips', async function() {
        const renderer = new FakeRenderer();
        const nodes = [{
          title: 'SKIP',
          requires: [],
          provides: ['a', 'b'],
          run: async (requirements, {skip}) => {
            return skip({a: 10, b: 20});
          },
        }];
        const graph = new TaskGraph(nodes, {renderer});
        const context = await graph.run();
        assume(context).to.deeply.equal({a: 10, b: 20});
        assume(renderer.updates).to.deeply.equal([
          'start',
          'state running SKIP',
          'state skipped SKIP',
          'stop',
        ]);
      });
    });

    suite('utils.step', function() {
      test('records a step update', async function() {
        const renderer = new FakeRenderer();
        const nodes = [{
          title: 'STEP',
          requires: [],
          provides: [],
          run: async (requirements, {step}) => {
            step({title: 'Step 1'});
            step({title: 'Step 2'});
          },
        }];
        const graph = new TaskGraph(nodes, {renderer});
        const context = await graph.run();
        assume(renderer.updates).to.deeply.equal([
          'start',
          'state running STEP',
          'step {"title":"Step 1"} STEP',
          'step {"title":"Step 2"} STEP',
          'state finished STEP',
          'stop',
        ]);
      });
    });

    suite('utils.status', function() {
      test('updates status', async function() {
        const renderer = new FakeRenderer();
        const nodes = [{
          title: 'STAT',
          requires: [],
          provides: [],
          run: async (requirements, {status}) => {
            status({message: 'hi'});
            status({progress: 50});
            status({progress: 100});
            status({message: 'bye'});
          },
        }];
        const graph = new TaskGraph(nodes, {renderer});
        const context = await graph.run();
        assume(renderer.updates).to.deeply.equal([
          'start',
          'state running STAT',
          'status {"message":"hi"} STAT',
          'status {"progress":50} STAT',
          'status {"progress":100} STAT',
          'status {"message":"bye"} STAT',
          'state finished STAT',
          'stop',
        ]);
      });
    });

    suite('utils.waitFor', function() {
      test('handles streams', async function() {
        const renderer = new FakeRenderer();
        const nodes = [{
          title: 'STR',
          requires: [],
          provides: [],
          run: async (requirements, {waitFor}) => {
            const s = new Readable();
            s.push(new Buffer('some da'));
            s.push(new Buffer('ta\nand another line\n'));
            s.push(new Buffer('third'));
            s.push(new Buffer(' line'));
            s.push(null);
            await waitFor(s);
          },
        }];
        const graph = new TaskGraph(nodes, {renderer});
        await graph.run();
        assume(renderer.updates).to.deeply.equal([
          'start',
          'state running STR',
          'log some data STR',
          'log and another line STR',
          'log third line STR',
          'state finished STR',
          'stop',
        ]);
      });

      test('handles observables', async function() {
        const renderer = new FakeRenderer();
        const nodes = [{
          title: 'OBS',
          requires: [],
          provides: [],
          run: async (requirements, {waitFor}) => {
            await waitFor(new Observable(observer => {
              setTimeout(() => observer.next('data 1'), 5);
              setTimeout(() => observer.next('data 2'), 10);
              setTimeout(() => observer.complete(), 15);
            }));
          },
        }];
        const graph = new TaskGraph(nodes, {renderer});
        await graph.run();
        assume(renderer.updates).to.deeply.equal([
          'start',
          'state running OBS',
          'log data 1 OBS',
          'log data 2 OBS',
          'state finished OBS',
          'stop',
        ]);
      });
    });
  });
});
