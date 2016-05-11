/**
 * Created by Aureliano on 24/03/2016.
 * Put in the queue and return
 */

'use strict';

/** global requires and vars */
var MODULE_NAME = 'FatusQueueOperation';
var LOCAL_DIR = '/digirest-src/operations/' + MODULE_NAME;
var FatusQueue = require('fatusjs');
var retry = require('retry');
var CloneFactory = require('cloneextend');
var funcster = require('funcster');


/**
 * the function to be invoked by the operation service
 * WARNING PARAMETER IS FIXED
 * @param funcParamObj
 * @param onExecuteComplete
 * @private
 */
function _queue(funcParamObj,onExecuteComplete){

    /** default object content of an operation */
    var operationObj = funcParamObj.operationRef;
    var data = funcParamObj.payload;

    var redirectEnv = operationObj.conf['params.redirect.env.name']
    var redirect = process.env[redirectEnv] || null;

    try {

        _insertInQueue(funcParamObj, operationObj, redirect, onExecuteComplete);

    }catch(error){

        /** dispatch the error to the next op in chain */
        onExecuteComplete(error,funcParamObj);
    }
}

/**
 * insert in queue
 * @param funcParamObj
 * @param operationObj
 * @param onExecuteComplete
 * @private
 */
function _insertInQueue(funcParamObj, operationObj, redirect, onExecuteComplete) {
// init
    let fatusQueue = FatusQueue.instance;
    let messageObj = fatusQueue.createMessageJob();
    messageObj.setMultiJob();

    // create payload
    let messagePayload = {};
    messagePayload.payload = funcParamObj.payload;
    //CloneFactory.clone(funcParamObj.payload);
    messagePayload.response = {}; //fake response
    messagePayload.operationRef = CloneFactory.clone(operationObj.next);

    // create the step-to-next-operation postRunFunction (runned into [FATUSJS].MessageJob.updateStepPayload method )
    messagePayload.postRunFunctionF = function (parameter) {
        // data === messagePayload
        parameter.operationRef = parameter.operationRef.next;
        return parameter;
    };
    // serialize it
    messagePayload.postRunFunction = funcster.serialize(messagePayload.postRunFunctionF);

    // don't pass worker to function
    messagePayload.skipWorker = true;

    // insert first step
    let op = operationObj.next;
    messageObj.addStep(op.modulepath, op.functionname, messagePayload);
    op = op.next;

    // insert others operations
    while (op) {
        if (op.modulepath && op.functionname) {
            messageObj.addStep(op.modulepath, op.functionname);
            op = op.next;
        } else {
            op = null;
        }
    }

    // init retrier
    var maxAttempt = 10;

    var retryOperation = retry.operation({
        retries: 10,
        factor: 1,
        minTimeout: 1 * 100,
        maxTimeout: 1 * 1000
    });

    messageObj.id = funcParamObj.request.originalUrl;

    // insert in queue
    retryOperation.attempt(
        function (currentAttempt) {
            fatusQueue.insertInQueue(
                messageObj.getMsg(),
                function (err, res) {
                    if (retryOperation.retry(err)) {
                        return;
                    } else {
                        if (currentAttempt == maxAttempt && err) {
                            // if queue not available skip and go on
                            console.log(MODULE_NAME + ': skipping in queue insertion for high error rates');
                            onExecuteComplete(null, funcParamObj);
                        } else {
                            _manageOK(operationObj, funcParamObj, redirect, onExecuteComplete);
                        }
                    }
                }
            )
        }
    );
}

/**
 * manage the ok send
 * @param operationObj
 * @param funcParamObj
 * @param redirect
 * @param onExecuteComplete
 * @private
 */
function _manageOK(operationObj, funcParamObj, redirect, onExecuteComplete){
    console.log(MODULE_NAME + ': operations moved in queue');
    operationObj.next = null;
    funcParamObj.payload = {success: true, enqueued: true};
    if(redirect) {
        funcParamObj.response.redirect(redirect);
    }
    onExecuteComplete(null, funcParamObj);
}


function _allQueue(funcParamObj,onExecuteComplete) {
    let fatusQueue = FatusQueue.instance;
    if(fatusQueue){
        fatusQueue.getAll()
    }
}




/** exports */
exports.queue=_queue;
exports.invoke=_queue;