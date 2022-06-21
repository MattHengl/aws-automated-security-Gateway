/*!
     * Copyright 2017-2017 Mutual of Enumclaw. All Rights Reserved.
     * License: Public
*/ 

//Mutual of Enumclaw 
//
//Matthew Hengl and Jocelyn Borovich - 2019 :) :)
//
//Main file that controls remediation and notifications of all EC2 VPC events. 
//Remediates actions when possible or necessary based on launch type and tagging. Then, notifies the user/security. 

//Make sure to that the master.invalid call does NOT have a ! infront of it
//Make sure to delete or comment out the change in the process.env.environtment

const AWS = require('aws-sdk');
AWS.config.update({region: process.env.region});
const ec2 = new AWS.EC2();
const Master = require("aws-automated-master-class/MasterClass").handler;
let path = require("aws-automated-master-class/MasterClass").path;
const master = new Master();

let improperLaunch = false;
let listParams = {};
let tags = {};
//Variables that allow these functions to be overridden in Jest testing by making the variable = jest.fn() 
//instead of its corresponding function
let callAutoTag = autoTag;
let callCheckTagsAndAddToTable = checkTagsAndAddToTable;
let callRemediate = remediate;
let callRemediateDynamo = remediateDynamo;
let callHandler = handleEvent;

//Only used for testing purposes
setEc2Function = (value, funct) => {
     ec2[value] = funct;
};

//A function that will handle the event and remediate it appropriately 
async function handleEvent(event){

     let resourceName = ''; //Creates an empty variable what will be used later in the notifyUser function MasterClass
     console.log(JSON.stringify(event));
     path.p = 'Path: \nEntered handleEvent';//Creates a path that we can use for testing

     //An if statement that checks to see if the event is a Dynamo DB event or not and then handles it correctly.
     if(master.checkDynamoDB(event)){

          //Converts the event into an unmarshalled event so we can use resources from the dynamo event
          let convertedEvent = master.dbConverter(event);
          console.log(convertedEvent);

          //extra console.log statements for testing ===================
          if(convertedEvent.ResourceName){
               console.log(`DynamoDB event "${convertedEvent.ResourceName}" is being inspected-------------`);
          }else{
               console.log(`DynamoDB event "${event.Records[0].dynamodb.Keys.ResourceName.S}" is being inspected!-----------`);
          }

          //If statement to check to see if the event coming from DynamoDB is a 'REMOVE' event and a Gateway Resource
          if(convertedEvent.ResourceType == 'Gateway' && event.Records[0].eventName == 'REMOVE'){
               path.p += '\nEvent is of type Gateway and has an event of REMOVE'; //Adds to the path
               try{
                    //Creating an object so we can check the tags on the resource coming from DynamoDB
                    let params = {
                         Filters: [
                              {
                                   Name: 'resource-id',
                                   Values: [
                                        event.Records[0].dynamodb.Keys.ResourceName.S
                                   ]
                              }
                         ]
                    };
                    //Calling a function from the API SDK and saving the results to the variable 'tags'
                    tags = await ec2.describeTags(params).promise();
                    console.log(tags);
                    //If statement to check if the correct tags are attached to the resource that is being inspected
                    if(!(master.tagVerification(tags.Tags))){
                         path.p += '\nResource has the incorrect tags'; //Adds to the path
                         //Calling notifyUser in the master class, as a parameter, also calls RemediateDynamo to remediate and return a results to use in notify
                         await master.notifyUser(event, await callRemediateDynamo(event, convertedEvent), 'Gateway');
                    };
               //Catch statement to catch an error if one were to appear in the try statement above
               }catch(e){
                    console.log(e);
                    path.p += '\nERROR';
                    console.log(path.p);
                    return e;
               }
          }else{
               //If the event is not of event 'REMOVE' and not of Gateway resource, will add to path and stop the program
               path.p += '\nEvent was not of type Gateway and didn\'t have an event of REMOVE'
          }
          //prints out the path and returns to stop the program
          console.log(path.p);
          // path.p = '';
          return;
     };

     try{

          event = master.devTest(event);
          //checks if there is an error in the log
          if(master.errorInLog(event)){
               console.log(path.p);
               // path.p = '';
               return;
          }

          //Checks if the log came from this function, quits the program if it does.
          if (master.selfInvoked(event)) {
               console.log(path.p);
               // path.p = '';
               return;
          }
     
          console.log(`Event action is ${event.detail.eventName}------------------------`);

          //If statement that is ONLY used for testing. This checkKeyUser function checks for a specific user and executes if the user manipulated the resource.
          //Delete this if statement when done with testing
          //if(master.checkKeyUser(event, resourceName)){
               //If statement that checks to see in which environment the resource is being deployed and how it is being deployed
               //Delete the ! if there is one. Only use ! for testing.
               if(!master.invalid(event)){

                    improperLaunch = true; //A variable to notate that the resource was launch improperly.
                    console.log('Calling notifyUser');

                    //Calling notifyUser in the master class, as a parameter, also calls Remediate to remediate and return a results to use in notify
                    await master.notifyUser(event, await callRemediate(event), 'Gateway');
                    // console.log('Finished calling notifyUser');

                    console.log(path.p);
                    // path.p = '';
                    return;
               }
               //If statement to check if the eventName includes 'delete'. If so, will only call notifyUser with the parameter of remediate
               if(event.detail.eventName.toLowerCase().includes('delete')){

                    // console.log('event is deleteUser');
                    await master.notifyUser(event, await callRemediate(event), 'Gateway');

               }else{
                    //If it's launched invalidly and doesn't have the eventName of 'delete', then the function CheckTagsAndAddToTable will be called, which will add the resource
                    //To a Dynamo DB table
                    // console.log('Event is being added to the table');
                    await callCheckTagsAndAddToTable(event);
               }
               console.log(path.p);
               // path.p = '';
          //}
     //Catch statement to catch an error if one were to appear in the try statement above
     }catch(e){
          console.log(e);
          path.p += '\nERROR';
          console.log(path.p);
          return e;
     }
};

//Checks for and auto adds tags and then adds resource to the table if it is missing any other tags.
async function checkTagsAndAddToTable(event){
     console.log('Entered checkTagsAndAddToTable');
     console.log(event);
     path.p += '\nEntering checkTagsAndAddToTable, Created params for function calls'; //Adds to the pathing
     try{
          path.p += '\nCalling AutoTag function'; //Adds to the pathing
          tags = await callAutoTag(event, findId(event)); //Calls autoTag to auotmatically tag the resource that is coming through
          //As a parameter, also calls findId which will find the correct ID for the remediation to continue
          console.log(tags);
          //If statement to check if the correct tags are attached to the resource that is being inspected
          //Returns true if the resource as the wrong tags and returns false if the resource has the correct tags.
          if(!(master.tagVerification(tags.Tags))){
               //Calls a function in masterClass which will put the item in the DynamoDB table
               // process.env.environment = 'snd';
               await master.putItemInTable(event, 'Gateway', findId(event));
               return true;
          }else{
               return false;
          }
     //Catch statement to catch an error if one were to appear in the try statement above
     }catch(e){
          console.log(e);
          path.p += '\nERROR';
          return e;
     }
};

//This is the main function that will be running the remediation functions from the API SDK
async function remediate(event){
     console.log('Entered remediate');
     path.p += '\nEntered the remediation function'; //Adds to the pathing
     const erp = event.detail.requestParameters;
     
     let params = {
          VpcId: erp.vpcId
     };
     //Calling a function in masterClass which will return an object to be saved to results
     let results = master.getResults(event, {});

     try{
          //A switch statement that will filer out different things to do for the eventName or Action coming in
          switch(results.Action){
               //Supports tags, but not on creation
               case 'CreateCustomerGateway':
                    await callRemediateDynamo(event, results);
               break;
               //data in folder
               //Supports tags, but not on creation
               case 'CreateEgressOnlyInternetGateway':
                    await callRemediateDynamo(event, results);
               break;
               //data in folder
               //Supports tags, but not on creation
               case 'CreateInternetGateway':
                    await callRemediateDynamo(event, results);
               break;
               //data in folder
               //Supports tags, also creation
               case 'CreateNatGateway':
                    await callRemediateDynamo(event, results);
               break;
               //data in folder
               //Supports tags, but not on creation
               case 'CreateVpnGateway':
                    await callRemediateDynamo(event, results);
               break;
               //data in folder
               case 'AttachInternetGateway':
                    path.p += '\nAttachInternetGateway';//Adds to the pathing
                    //Checks to see where and how the resource was created
                    if(master.invalid(event)){
                         //add a tag or environment variable to the resource with the VPC id
                         params = {};
                         params.Resources = [findId(event)];
                         params.Tags = [{Key: 'Vpc Id', Value: erp.vpcId}];
                         await ec2.createTags(params).promise();
                         results.ResourceName = params.Resources;
                         results.Response = 'Createing a new tag for resource';
                    }else{
                         //remediate the resource by detaching the resource from the thing that it was attached to
                         params.InternetGatewayId = findId(event);
                         await overrideFunction('detachInternetGateway', params);
                         results.ResourceName = params.InternetGatewayId;
                         results.Response = 'DetachInternetGateway';
                    }
               break;
               //data in folder
               case 'AttachVpnGateway':
                    path.p += '\nAttachVpnGateway';//Adds to the pathing
                    //Checks to see where and how the resource was created
                    if(master.invalid(event)){
                         //add a tag or environment variable to the resource with the VPC id
                         params = {};
                         params.Resources = [findId(event)];
                         params.Tags = [{Key: 'Vpc Id', Value: erp.vpcId}];
                         await ec2.createTags(params).promise();
                         results.ResourceName = params.Resources;
                         results.Response = 'Createing a new tag for resource';
                    }else{
                         //remediate the resource by detaching the resource from the thing that it was attached to
                         params.VpnGatewayId = findId(event);
                         await overrideFunction('detachVpnGateway', params);
                         results.ResourceName = params.VpnGatewayId;
                         results.Response = 'DetachVpnGateway';
                    }
               break;
               //data in folder
               case 'DetachInternetGateway':
                    path.p += '\nDetachInternetGateway';//Adds to the pathing
                    params.InternetGatewayId = findId(event);
                    await overrideFunction('attachInternetGateway', params);
                    results.ResourceName = params.InternetGatewayId;
                    results.Response = 'AttachInternetGateway';
               break;
               //data in folder
               //Need to create these resources to get the data to execute them
               case 'DetachVpnGateway':
                    path.p += '\nDetachVpnGateway';//Adds to the pathing
                    params.VpnGatewayId = findId(event);
                    await overrideFunction('attachVpnGateway', params);
                    results.ResourceName = params.VpnGatewayId;
                    results.Response = 'AttachVpnGateway';
               break;
               case 'DeleteCustomerGateway':
                    path.p += '\nDeleteCustomerGateway';//Adds to the pathing
                    results.ResourceName = erp.customerGatewayId;
               break;
               //data in folder
               case 'DeleteEgressOnlyInternetGateway':
                    path.p += '\nDeleteEgressOnlyInternetGateway';//Adds to the pathing
                    results.ResourceName = erp.DeleteEgressOnlyInternetGatewayRequest.EgressOnlyInternetGatewayId;
               break;
               //data in folder
               case 'DeleteInternetGateway':
                    path.p += '\nDeleteInternetGateway';//Adds to the pathing
                    results.ResourceName = erp.internetGatewayId;
               break;
               //data in folder
               case 'DeleteNatGateway':
                    path.p += '\nDeleteNatGateway';//Adds to the pathing
                    results.ResourceName = erp.DeleteNatGatewayRequest.NatGatewayId;
               break;
               //data in folder
               case 'DeleteVpnGateway':
                    path.p += '\nDeleteVpnGateway';//Adds to the pathing
                    results.ResourceName = erp.vpnGatewayId;
               break;
          }
     //Catch statement to catch an error if one were to appear in the try statement above
     }catch(e){
          console.log(e);
          path.p += '\nERROR';
          return e;
     }
     //If statement that checks to see if the Action is a 'delete' action
     if(results.Action.toLowerCase().includes('delete')){
          results.Response = 'Remediation could not be performed';
          delete results.Reason;
     }
     if(improperLaunch == true){
          results.Reason = 'Improper Launch';
     }
     path.p += '\nRemediation was finished';//Adds to the pathing
     // await master.notifyUser(event, results, 'Gateway');
     console.log(results);
     return results;
}

async function remediateDynamo(event, results){
     console.log(results);
     path.p += '\nEntered RemediateDynamo'; //Adds to pathing
     let params = {};
     try{
          switch(results.Action){
               //Supports tags, but not on creation
               case 'CreateCustomerGateway':
                    console.log('Don\'t know what to do yet!!');
                    //If/else statement that checks to see if the event that is coming in is a DynamoDB event or not.
                    //If the event IS DynamoDB, it will contain a KillTime, so then we know where to find the resourceName and ResourceId
                    if(master.checkDynamoDB(event)){
                         console.log('Event is dynamoDB');
                         path.p += '\nCreateCustomerGateway';//Adds to the pathing
                         params.CustomerGatewayId = results.ResourceName;
                    }else{
                         console.log('Event is not dynamoDB');
                         path.p += '\nCreateCustomerGateway';//Adds to the pathing
                         params.CustomerGatewayId = findId(event);
                         console.log('exiting if statement');
                    }
                    console.log('entering overrideFunction');
                    await overrideFunction('deleteCustomerGateway', params);
                    console.log('exiting overrideFunction');
                    results.ResourceName = params.CustomerGatewayId;
                    results.Response = 'DeleteCustomerGateway';
               break;
               //data in folder
               //Supports tags, but not on creation
               case 'CreateEgressOnlyInternetGateway':
                    //If/else statement that checks to see if the event that is coming in is a DynamoDB event or not.
                    //If the event IS DynamoDB, it will contain a KillTime, so then we know where to find the resourceName and ResourceId
                    if(master.checkDynamoDB(event)){
                         console.log('Event is dynamoDB');
                         path.p += '\nCreateEgressOnlyInternetGateway';//Adds to the pathing
                         params.EgressOnlyInternetGatewayId = results.ResourceName;
                    }else{
                         console.log('Event is not dynamoDB');
                         path.p += '\nCreateEgressOnlyInternetGateway';//Adds to the pathing
                         params.EgressOnlyInternetGatewayId = findId(event);
                    }
                    await overrideFunction('deleteEgressOnlyInternetGateway', params);
                    results.ResourceName = params.EgressOnlyInternetGatewayId;
                    results.Response = 'DeleteEgressOnlyInternetGateway';
               break;
               //data in folder
               //Supports tags, but not on creation
               case 'AttachInternetGateway':
               case 'CreateInternetGateway':
                    //If/else statement that checks to see if the event that is coming in is a DynamoDB event or not.
                    //If the event IS DynamoDB, it will contain a KillTime, so then we know where to find the resourceName and ResourceId
                    if(master.checkDynamoDB(event)){
                         console.log('Event is dynamoDB');
                         params.InternetGatewayId = results.ResourceName;
                         console.log(event.Records[0].dynamodb.OldImage.Action.S);
                         path.p += `\n${event.Records[0].dynamodb.OldImage.Action.S}`
                    }else{
                         console.log('Event is not dynamoDB');
                         //A nested if/else statement that checks the evenName for the event of 'Create'.
                         if(event.detail.eventName.includes('Create')){
                              path.p += '\nCreateInternetGateway';//Adds to the pathing
                              params.InternetGatewayId = findId(event);
                         }else{
                              path.p += '\nAttachInternetGateway';//Adds to the pathing
                              params.InternetGatewayId = findId(event);
                         }
                         console.log('Got the params');
                    }
                    console.log('Building the list params');
                    listParams = {
                         Filters: [
                              {
                                   Name: 'resource-id',
                                   Values: [
                                        params.InternetGatewayId
                                   ]
                              }
                         ]
                    };
                    console.log('describing tags');
                    tags = await ec2.describeTags(listParams).promise();  //This needs Params to have a property of Filters with a Key/Value object
                    //Creating a variable to use in a findIndex dot operator
                    let internetGatewayFound = (element) => element.Key == 'Vpc Id';
                    let internetGatewayPlaceHolder = tags.Tags.findIndex(internetGatewayFound); //findIndex statement
                    //If statement to check to see if it fould the tag in the array or tags.
                    //If the tag was found then it will save the appropriate values and then call the needed API functions to delete that tag and detach the resource
                    if(internetGatewayPlaceHolder != -1){
                         params.VpcId = tags.Tags[internetGatewayPlaceHolder].Value;
                         let deleteTagParams = {
                              Resources: [params.InternetGatewayId],
                              Tags: [{Key: 'Vpc Id', Value: params.VpcId}]
                         };
                         await ec2.deleteTags(deleteTagParams).promise();  //This needs the Params to have a Resources array and a Tags Array that have a Key/Value Object
                         await overrideFunction('detachInternetGateway', params);
                         delete params.VpcId;
                    }
                    //If the tag was not found, then the resource will just be deleted
                    await overrideFunction('deleteInternetGateway', params);
                    results.ResourceName = params.InternetGatewayId;
                    results.Response = 'DeleteInternetGateway';
               break;
               case 'DetachInternetGateway':
                    if(master.checkDynamoDB(event)){
                         console.log('Event is dynamoDB');
                         params.InternetGatewayId = results.ResourceName;
                         path.p += '\nDetachInternetGateway';//Adds to the pathing
                    }else{
                         console.log('Event is not dynamoDB');
                         path.p += '\nDetachInternetGateway';//Adds to the pathing
                         params.InternetGatewayId = findId(event);
                    }
                    await overrideFunction('deleteInternetGateway', params);
                    results.ResourceName = params.VpnGatewayId;
                    results.Response = 'DeleteInternetGateway';
               break;
               //data in folder
               //Supports tags, also creation
               case 'CreateNatGateway':
                    if(master.checkDynamoDB(event)){
                         console.log('Event is dynamoDB');
                         path.p += '\nCreateNatGateway';//Adds to the pathing
                         params.NatGatewayId = results.ResourceName;
                    }else{
                         console.log('Event is not dynamoDB');
                         path.p += '\nCreateNatGateway';//Adds to the pathing
                         params.NatGatewayId = findId(event);
                    }
                    await overrideFunction('deleteNatGateway', params);
                    results.ResourceName = params.NatGatewayId;
                    results.Response = 'DeleteNatGateway';
               break;
               //data in folder
               //Supports tags, but not on creation
               case 'CreateVpnGateway':
               case 'AttachVpnGateway':
                    //If/else statement that checks to see if the event that is coming in is a DynamoDB event or not.
                    //If the event IS DynamoDB, it will contain a KillTime, so then we know where to find the resourceName and ResourceId
                    console.log('CreateVpnGateway/AttachVpnGateway');
                    if(master.checkDynamoDB(event)){
                         console.log('Event is dynamoDB');
                         params.VpnGatewayId = results.ResourceName;
                         path.p += `\n${event.Records[0].dynamodb.OldImage.Action.S}`;
                         console.log('CreateVpnGateway/AttachVpnGateway');
                    }else{
                         console.log('Event is not dynamoDB');
                         //A nested if/else statement that checks the evenName for the event of 'Create'.
                         if(event.detail.eventName.includes('Create')){
                              path.p += '\nCreateVpnGateway';//Adds to the pathing
                              params.VpnGatewayId = findId(event);
                         }else{
                              path.p += '\nAttachVpnGateway';//Adds to the pathing
                              params.VpnGatewayId = findId(event);
                         }
                    }   
                    console.log('Creating listParams');                       
                    listParams = {
                         Filters: [
                              {
                                   Name: 'resource-id',
                                   Values: [
                                        params.VpnGatewayId
                                   ]
                              }
                         ]
                    };                   
                    //Needs to look through the tags for the vpcId so it can detach
                    tags = await ec2.describeTags(listParams).promise();  //This needs Params to have a property of Filters with a Key/Value object
                    //Creating a variable to use in a findIndex dot operator
                    let vpnFound = (element) => element.Key == 'Vpc Id';
                    let vpnPlaceHolder = tags.Tags.findIndex(vpnFound) //findIndex statement
                    //If statement to check to see if it fould the tag in the array or tags.
                    //If the tag was found then it will save the appropriate values and then call the needed API functions to delete that tag and detach the resource
                    if(vpnPlaceHolder != -1){
                         params.VpcId = tags.Tags[vpnPlaceHolder].Value;
                         let deleteTagParams = {
                              Resources: [params.VpnGatewayId],
                              Tags: [{Key: 'Vpc Id', Value: params.VpcId}]
                         };
                         console.log('Deleting tags');
                         await ec2.deleteTags(deleteTagParams).promise();  //This needs the Params to have a Resources array and a Tags Array that have a Key/Value Object
                         await overrideFunction('detachVpnGateway', params);
                    }
                    //If the tag was not found, then the resource will just be deleted
                    delete params.VpcId;
                    console.log(params);
                    //Detachs the vpn from the VPCGateway and then Deletes the VPN
                    await overrideFunction('deleteVpnGateway', params);
                    results.ResourceName = params.VpnGatewayId;
                    results.Response = 'DeleteVpnGateway';

               break;
               case 'DetachVpnGateway':
                    //If/else statement that checks to see if the event that is coming in is a DynamoDB event or not.
                    //If the event IS DynamoDB, it will contain a KillTime, so then we know where to find the resourceName and ResourceId
                    if(master.checkDynamoDB(event)){
                         console.log('Event is dynamoDB');
                         params.VpnGatewayId = results.ResourceName;
                         path.p += '\nDetachVpnGateway';//Adds to the pathing
                    }else{
                         console.log('Event is not dynamoDB');
                         path.p += '\nDetachVpnGateway';//Adds to the pathing
                         params.VpnGatewayId = findId(event);
                    }
                    await overrideFunction('deleteVpnGateway', params);
                    results.ResourceName = params.VpnGatewayId;
                    results.Response = 'DeleteVpnGateway';
               break;
          }   
     //Catch statement to catch an error if one were to appear in the try statement above
     }catch(e){
          console.log(e);
          path.p += '\nERROR';
          return e;
     }
     // console.log(results);
     return results;
};
//This function adds the nessessary tags to the resource coming in.
async function autoTag(event, id){
     path.p += '\nEntering Autotag function';
     console.log('Entered autoTag');
     let params = {};
     //list the tags that are on each resource
     let listParams = {
          Filters: [
               {
                    Name: 'resource-id',
                    Values: [
                         id
                    ]
               }
          ]
     };
     try{
          tags = await ec2.describeTags(listParams).promise();
          params.Resources = [id];

          //If statement that checks to see if the resource was launched through 'sandbox' and checks to see if the resource needs 'tag3'
          if(master.snd(event) && master.needsTag(tags.Tags, `${process.env.tag3}`)){
               //adds the tag to the resource
               path.p += `\nAdding ${process.env.tag3}`;
               await ec2.createTags(await master.getParamsForAddingTags(event, params, `${process.env.tag3}`)).promise();
          }
          //If statement that checks to see if the resource needs the tag 'Environment'
          if(master.needsTag(tags.Tags, 'Environment')){
               //adds the tag to the resource
               path.p += `\nAdded Environment`;
               await ec2.createTags(await master.getParamsForAddingTags(event, params, `Environment`)).promise();
          }
          //If statement that checks the eventName to see if it is an event of 'attach'
          if(event.detail.eventName.toLowerCase().includes('attach')){
               //If/else statement that checks the eventName. This is needed to grab the correct ID for what resource is being looked at
               if(event.detail.eventName.includes('InternetGateway')){
                    path.p += `\nAdding VpcId tag to InternetGateway`;
                    params.Resources = [event.detail.requestParameters.internetGatewayId];
                    params.Tags = [{Key: 'Vpc Id', Value: event.detail.requestParameters.vpcId}];
               }else{
                    path.p += '\nAdding VpcId tag to VpnGateway'
                    params.Resources = [event.detail.requestParameters.vpnGatewayId]
                    params.Tags = [{Key: 'Vpc Id', Value: event.detail.requestParameters.vpcId}];
               }
               await ec2.createTags(params).promise();
          }
          //If statement that checks the eventName to see if it is an event of 'detach'
          if(event.detail.eventName.toLowerCase().includes('detach')){
               //If/else statement that checks the eventName. This is needed to grab the correct ID for what resource is being looked at
               if(event.detail.eventName.includes('InternetGateway')){
                    path.p += '\nDeleting VpcId tag from InternetGateway';
                    params = {
                         Resources: [event.detail.requestParameters.internetGatewayId],
                         Tags: [{Key: 'Vpc Id', Value: event.detail.requestParameters.vpcId}]
                    };
               }else{
                    path.p += '\nDeleteing VpcIs tag from VpnGateway';
                    params = {
                         Resources: [event.detail.requestParameters.vpnGatewayId],
                         Tags: [{Key: 'Vpc Id', Value: event.detail.requestParameters.vpcId}]
                    };
               }
               ec2.deleteTags(params).promise();
          }
          path.p += '\nAutoTag Complete';
          tags = await ec2.describeTags(listParams).promise();
          console.log(tags);
          return tags;
          
     //Catch statement to catch an error if one were to appear in the try statement above
     }catch(e){
          console.log(e);
          path.p += '\nERROR';
          return e;
     }
};
//This function is used to get the correct information depending on the eventName on the resource
function findId(event){
     path.p += '\nEntered findId';
     try{
          switch(event.detail.eventName){
               case "AttachInternetGateway":
                    console.log('AttachInternetGateway');
                    return event.detail.requestParameters.internetGatewayId;
               case "AttachVpnGateway":
                    console.log('AttachVpnGateway');
                    return event.detail.requestParameters.vpnGatewayId;
               case "CreateCustomerGateway":
                    return event.detail.responseElements.customerGateway.customerGatewayId;
               case "CreateEgressOnlyInternetGateway":
                    console.log('CreateEgressOnlyInternetGateway');
                    return event.detail.responseElements.CreateEgressOnlyInternetGatewayResponse.egressOnlyInternetGateway.egressOnlyInternetGatewayId;
               case "CreateInternetGateway":
                    console.log('CreateInternetGateway');
                    return event.detail.responseElements.internetGateway.internetGatewayId;
               case "CreateNatGateway":
                    console.log('CreateNatGateway');
                    return event.detail.responseElements.CreateNatGatewayResponse.natGateway.natGatewayId;
               case "CreateVpnGateway":
                    console.log('CreateVpnGateway');
                    return event.detail.responseElements.vpnGateway.vpnGatewayId;
               case "DetachInternetGateway":
                    console.log('DetachInternetGateway');
                    return event.detail.requestParameters.internetGatewayId;
               case "DetachVpnGateway":
                    console.log('DetachVpnGateway');
                    return event.detail.requestParameters.vpnGatewayId;
          }
     }catch(e){
          console.log(e);
          path.p += '\nERROR';
          return e;
     }
};

async function overrideFunction(apiFunction, params){
     if(process.env.run == 'false'){
       await setEc2Function(apiFunction, (params) => {
         console.log(`Overriding ${apiFunction}`);
         return {promise: () => {}};
       });
     }
     await ec2[apiFunction](params).promise();
};

//This block of exports allow us to export not only our handler to execute but also other functions for testing purposes
exports.handler = handleEvent;
exports.checkTagsAndAddToTable = checkTagsAndAddToTable; 
exports.remediateDynamo = remediateDynamo;
exports.autoTag = autoTag;
exports.remediate = remediate;
exports.findId = findId;

//This export function allows us the ability to override certain functions.
//Here' we would give the value as the API function call from the SDK in which we want to over ride, then the funct would be what we want it to acctually do
//Example from a jest file:
// await main.setEc2Function('describeTags', (params) => {
//      return {promise: () => {throw new Error()}};
//  });
//Anything can be in the function that is being returned as a promise. DOES NOT ALWAYS HAVE TO BE THROW NEW ERROR
exports.setEc2Function = (value, funct) => {
     ec2[value] = funct;
};
exports.setDBFunction = (value, funct) => {
     dynamodb[value] = funct;
};
//These export functions allows us to create fake jest functions in a jest file so we can simulate them without executing them
exports.setHandler = (funct) => {
     callHandler = funct;
};
exports.setAutoTag = (funct) => {
     callAutoTag = funct;
};
exports.setRemediate = (funct) => {
     callRemediate = funct;
};
exports.setRemediateDynamo = (funct) => {
     callRemediateDynamo = funct;
};
exports.setCheckTagsAndAddToTable = (funct) => {
     callCheckTagsAndAddToTable = funct;
};